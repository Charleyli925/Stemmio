import { withRuntimeFailureEvidence } from "./helpers/runtime-failure-evidence.mjs";
import { readPublishedWorkingCopy } from "./helpers/working-copy-publication.mjs";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { boundFrozenInspectorCache } from "./helpers/frozen-inspector-cache.mjs";
import { verifyMixedComments, verifyFrozenCommentCard, revealFrozenCommentCard, revealFrozenCommentDelete } from "./real-html/frozen-mixed.mjs";
import { expect, test } from "@playwright/test";
import { FROZEN_ELEMENT_OPERATIONS, frozenDigest, frozenFrameAccess, executeFrozenSelection, verifyFrozenHostPoint } from "./real-html/frozen-selection.mjs";
import { executeFrozenText, requireFrozenTextFocus } from "./real-html/frozen-text.mjs";
import { startRuntimeLifecycleObservation, stopRuntimeLifecycleObservation } from "./real-html/runtime-observer.mjs";

import { EDIT_AUTHOR_RUNTIME_BUDGET } from "../../../app/domain/edit-runtime-contract.js";

import {
  activateNativeEdit,
  bridgeJson,
  closeStemmioGracefully,
  currentEditorFrame,
  doubleClickRenderedText,
  disableStructuralInPlace,
  documentToken,
  ECHARTS_STUB,
  expectCheckpointPersisted,
  keyShortcut,
  launchStemmio,
  loadedDiskFrame,
  managedWorkingCopyPath,
  mkdirSync,
  mkdtempSync,
  path,
  readFileSync,
  removeValidatedTemporaryDirectory,
  stopStemmio,
  tmpdir,
  openRecentProject,
  writeFileSync,
  waitForRuntimeHandoffSettled,
  waitForProjectReady,
} from "./electron-native-harness.mjs";

async function withRuntimeProject(
  prefix,
  files,
  run,
  launchOptions = {},
  evidence = null,
) {
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), prefix));
  const sourcePath = path.join(sourceDirectory, "runtime-report.html");
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = path.join(sourceDirectory, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, content, "utf8");
  }
  const evidenceEnabled = Boolean(evidence?.testInfo && evidence?.caseId);
  const diagnosticSourcePath = path.join(sourceDirectory, "runtime-diagnostic.html");
  if (evidenceEnabled) {
    writeFileSync(
      diagnosticSourcePath,
      "<!doctype html><html><head><title>Runtime diagnostic</title></head><body><main>诊断起始页</main></body></html>",
      "utf8",
    );
  }
  const session = {
    electronApp: null,
    page: null,
    isolatedUserData: null,
  };
  let hadFailure = false;
  try {
    Object.assign(session, await launchStemmio({
      activeSourcePath: sourcePath,
      ...launchOptions,
      ...(evidenceEnabled ? {
        activeSourcePath: diagnosticSourcePath,
        recentSourcePaths: [diagnosticSourcePath, sourcePath],
      } : {}),
    }));
    const runProject = () => run({
      get page() {
        return session.page;
      },
      get electronApp() {
        return session.electronApp;
      },
      sourcePath,
      isolatedUserData: session.isolatedUserData,
      relaunch: async () => {
        if (!session.electronApp || !session.page) {
          throw new Error("Stemmio session is not running.");
        }
        const closedApp = session.electronApp;
        const closedPage = session.page;
        session.electronApp = null;
        session.page = null;
        let closedProcess = null;
        try {
          closedProcess = closedApp.process();
        } catch {
          closedProcess = null;
        }
        await closeStemmioGracefully(closedApp, closedPage);
        if (closedProcess && closedProcess.exitCode == null && !closedProcess.killed) {
          await Promise.race([
            new Promise((resolve) => closedProcess.once("exit", resolve)),
            new Promise((resolve) => {
              setTimeout(resolve, 15_000);
            }),
          ]);
        }
        Object.assign(session, await launchStemmio({
          isolatedUserData: session.isolatedUserData,
        }));
        return session;
      },
    });
    if (evidenceEnabled) {
      await withRuntimeFailureEvidence(
        session.page,
        evidence.testInfo,
        runProject,
        { caseId: evidence.caseId },
      );
    } else {
      await runProject();
    }
  } catch (cause) {
    hadFailure = true;
    throw cause;
  } finally {
    let cleanupError = null;
    if (session.electronApp && session.isolatedUserData) {
      try {
        await stopStemmio(session.electronApp, session.isolatedUserData);
      } catch (cause) {
        cleanupError ||= cause;
        try {
          removeValidatedTemporaryDirectory(session.isolatedUserData, "stemmio-native-e2e-");
        } catch (fallbackCause) {
          cleanupError ||= fallbackCause;
        }
      }
    } else if (session.isolatedUserData) {
      try {
        removeValidatedTemporaryDirectory(session.isolatedUserData, "stemmio-native-e2e-");
      } catch (cause) {
        cleanupError ||= cause;
      }
    }
    try {
      removeValidatedTemporaryDirectory(sourceDirectory, prefix);
    } catch (cause) {
      cleanupError ||= cause;
    }
    if (!hadFailure && cleanupError) throw cleanupError;
  }
}

test("frozen character selection reveals oversized targets and rejects clipped host points", async () => {
  const text = "Fixed character " + "cumulative content ".repeat(100);
  const html = `<!doctype html><html><head><title>Fixed point</title></head><body><p data-native-case="oversized" style="width:400px;font-size:60px">${text}</p></body></html>`;
  await withRuntimeProject("stemmio-frozen-oversized-", { "runtime-report.html": html }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "oversized");
    const locator = frame.locator('[data-native-case="oversized"]');
    const id = await locator.getAttribute("data-stemmio-id");
    const handle = await locator.elementHandle();
    await expect(verifyFrozenHostPoint(handle, { x: 20, y: -10 }))
      .rejects.toMatchObject({ code: "FROZEN_HOST_POINTER_HIT_MISMATCH", details: { withinViewport: false, hostHitMatches: false } });
    await expect(verifyFrozenHostPoint(handle, { x: 20, y: 20 }))
      .rejects.toMatchObject({ code: "FROZEN_HOST_POINTER_HIT_MISMATCH" });
    await handle.dispose();
    await locator.evaluate(element => element.scrollIntoView({ block: "end", behavior: "instant" }));
    const target = { clickId: id, selectedId: id, clickTag: "p", selectedTag: "p", selectionClick: "frozen-text-character",
      textEntry: { path: [0], offset: 0, textSha256: frozenDigest(text) } };
    const calls = [];
    const result = await executeFrozenSelection({ access: frozenFrameAccess(frame, target, calls), keyboard: page.keyboard,
      mouse: page.mouse, target, calls });
    expect(result.state).toBe("PASS");
    expect(calls.filter(call => call.kind === "pointer-click")).toHaveLength(1);
    expect(calls.find(call => call.kind === "pointer-click").host)
      .toMatchObject({ withinViewport: true, activeFrame: true, hostHitMatches: true });
  });
});

test("frozen element entry rejects wrong text bindings and edits heading paragraph list and cell", async () => {
  test.setTimeout(90_000);
  const html = '<!doctype html><html><head><style>h1,p,li,td{font-size:18px;font-weight:400}</style></head><body>'
    + '<h1 data-native-case="entry-heading"> Heading</h1><p data-native-case="entry-paragraph">  Paragraph <i>tail</i>.</p>'
    + '<ul><li data-native-case="entry-list"><b>Label</b> item</li></ul>'
    + '<p data-native-case="entry-tail">  Footer <a href="#">link</a>.\n    </p>'
    + '<table><tbody><tr><td data-native-case="entry-cell">Cell</td></tr></tbody></table></body></html>';
  await withRuntimeProject("stemmio-frozen-elements-", { "runtime-report.html": html }, async ({ page, sourcePath }) => {
    const { editor, frame } = await loadedDiskFrame(page, sourcePath, "entry-heading");
    const working = await managedWorkingCopyPath(page, sourcePath);
    await editor.evaluate(startRuntimeLifecycleObservation);
    try {
      for (const [index, [name, tag, entryPath, offset, text, trailingText = ""]] of [
        ["entry-heading", "h1", [0], 1, " Heading"], ["entry-paragraph", "p", [0], 2, "  Paragraph "],
        ["entry-list", "li", [1], 1, " item"], ["entry-cell", "td", [0], 0, "Cell"],
        ["entry-tail", "p", [0], 2, "  Footer ", "\n    "],
      ].entries()) {
        const id = await frame.locator(`[data-native-case="${name}"]`).getAttribute("data-stemmio-id");
        const target = { clickId: id, selectedId: id, clickTag: tag, selectedTag: tag, mapping: "self",
          selectionClick: "frozen-text-character",
          operations: FROZEN_ELEMENT_OPERATIONS, textEntry: { path: entryPath, offset, textSha256: frozenDigest(text), trailingText },
          initialBold: false, historyAdoption: "editable-island-in-place", historyResume: "in-place",
          formatCapability: { scope: "element" } };
        const calls = [], access = frozenFrameAccess(frame, target, calls);
        if (index === 0) {
          const wrongTagCalls = [], wrongHashCalls = [];
          await expect(executeFrozenSelection({ access: frozenFrameAccess(frame, target, wrongTagCalls), keyboard: page.keyboard, mouse: page.mouse,
            target: { ...target, clickTag: "aside" }, calls: wrongTagCalls }))
            .rejects.toMatchObject({ code: "FROZEN_IDENTITY_MISMATCH" });
          await expect(executeFrozenSelection({ access: frozenFrameAccess(frame, target, wrongHashCalls), keyboard: page.keyboard, mouse: page.mouse,
            target: { ...target, textEntry: { ...target.textEntry, textSha256: "a".repeat(64) } }, calls: wrongHashCalls }))
            .rejects.toMatchObject({ code: "FROZEN_CLICK_TEXT_DRIFT" });
        }
        await executeFrozenSelection({ access, keyboard: page.keyboard, mouse: page.mouse, target, calls });
        const rows = () => target.operations.map(operation => ({ operation, state: "NOT_EXECUTED", reason: "DEPENDENCY_NOT_COMPLETED" }));
        const input = { frame, access, page, editor, calls, fileId: `H0${index + 1}`,
          readSource: () => readPublishedWorkingCopy(working, null) };
        if (index === 0) {
          const before = readFileSync(working);
          for (const [entry, code] of [[{ ...target.textEntry, textSha256: "a".repeat(64) }, "FROZEN_ENTRY_TEXT_DRIFT"],
            [{ ...target.textEntry, path: [999] }, "FROZEN_TEXT_PLAIN_LEAF_DRIFT"]]) {
            await expect(executeFrozenText({ ...input, target: { ...target, textEntry: entry }, rows: rows() }))
              .rejects.toMatchObject({ code });
            expect(readFileSync(working)).toEqual(before);
          }
        }
        if (trailingText) {
          const before = readFileSync(working);
          await expect(executeFrozenText({ ...input, target: { ...target,
            textEntry: { ...target.textEntry, trailingText: "" } }, rows: rows() }))
            .rejects.toMatchObject({
              code: "FROZEN_TEXT_FOCUS_MISMATCH",
              details: { conditions: {
                identityMatches: true,
                focusMatches: true,
                editable: true,
                selectionInside: true,
                caretAtEnd: false,
              } },
            });
          const handle = await access.target(id).elementHandle();
          await requireFrozenTextFocus(handle, id, { atEnd: true, trailingText });
          await expect(requireFrozenTextFocus(handle, id, { atEnd: true, trailingText: "    " }))
            .rejects.toMatchObject({ code: "FROZEN_TEXT_FOCUS_MISMATCH" });
          await page.keyboard.press("ArrowLeft");
          await expect(requireFrozenTextFocus(handle, id, { atEnd: true, trailingText }))
            .rejects.toMatchObject({ code: "FROZEN_TEXT_FOCUS_MISMATCH" });
          expect(readFileSync(working)).toEqual(before);
        }
        const operationRows = rows();
        // Observe native key delivery and selection changes without repairing
        // focus or synthesizing a caret. Retain only this synthetic target.
        const focusTrace = await frame.evaluateHandle((targetId) => {
          const host = document.querySelector(`[data-stemmio-id="${targetId}"]`);
          const events = [];
          const nodePath = (node) => {
            if (!node || !host.contains(node)) return null;
            const path = [];
            while (node !== host) {
              path.unshift(Array.prototype.indexOf.call(node.parentNode.childNodes, node));
              node = node.parentNode;
            }
            return path;
          };
          const observe = (event) => {
            // A microtask sees whether any product handler canceled the key.
            queueMicrotask(() => {
              const selection = document.getSelection();
              events.push({ type: event.type, key: event.key, metaKey: event.metaKey,
                defaultPrevented: event.defaultPrevented, time: performance.now(),
                documentFocused: document.hasFocus(), activeId: document.activeElement?.getAttribute("data-stemmio-id"),
                anchor: nodePath(selection?.anchorNode), anchorOffset: selection?.anchorOffset,
                focus: nodePath(selection?.focusNode), focusOffset: selection?.focusOffset,
                selectedText: selection?.toString(), collapsed: selection?.isCollapsed });
              if (events.length > 120) events.shift();
            });
          };
          const types = ["keydown", "keyup", "selectionchange", "focusin", "focusout"];
          types.forEach(type => document.addEventListener(type, observe, true));
          return { events, stop: () => types.forEach(type => document.removeEventListener(type, observe, true)) };
        }, id);
        let result;
        try { result = await executeFrozenText({ ...input, target, rows: operationRows }); }
        catch (error) {
          await test.info().attach("frozen-operation-failure", { contentType: "application/json",
            body: JSON.stringify({ name, rows: operationRows, code: error.code, details: error.details,
              events: await focusTrace.evaluate(trace => trace.events) }) });
          throw error;
        } finally {
          await focusTrace.evaluate(trace => trace.stop());
          await focusTrace.dispose();
        }
        expect(result.state).toBe("PASS");
      }
    } finally { await editor.evaluate(stopRuntimeLifecycleObservation); }
  });
});

for (const releaseBeforeBlur of [false, true]) {
  test(`transient native blur preserves the latest caret before Backspace: state RAF released=${releaseBeforeBlur}`, async () => {
    const html = '<!doctype html><html><head><title>Native caret</title></head><body>'
      + '<p data-native-case="entry-paragraph">  Paragraph <i>tail</i>.</p></body></html>';
    await withRuntimeProject("stemmio-native-blur-caret-", { "runtime-report.html": html }, async ({ page, sourcePath }) => {
      const { frame } = await loadedDiskFrame(page, sourcePath, "entry-paragraph");
      const target = frame.locator('[data-native-case="entry-paragraph"]');
      const working = await managedWorkingCopyPath(page, sourcePath);
      const id = await target.getAttribute("data-stemmio-id");
      const handle = await target.elementHandle();
      await doubleClickRenderedText(target);
      await expect(target).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
      await page.keyboard.press(keyShortcut("ArrowDown"));
      await page.keyboard.type(" PRCORE_H02");
      // Use the host realm: the static document intentionally forbids author
      // scripts, so callbacks created inside that realm cannot drive waits.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const before = await target.textContent();
      await page.evaluate(() => {
        const frameWindow = document.querySelector('iframe[data-runtime-slot-role="active"]').contentWindow;
        const request = frameWindow.requestAnimationFrame.bind(frameWindow);
        const held = [];
        // Freeze this exact frame's notifications for one keystroke. No input,
        // focus or Selection is replaced; releasing runs the original callbacks.
        frameWindow.requestAnimationFrame = callback => { held.push(callback); return -1000-held.length; };
        window.__STEMMIO_TEST_NATIVE_CARET_RAF__ = {
          held,
          release() {
            frameWindow.requestAnimationFrame = request;
            for (const callback of held.splice(0)) request(callback);
          },
        };
      });
      try {
        await page.keyboard.type("X");
        expect(await target.textContent()).toBe(`${before}X`);
        await requireFrozenTextFocus(handle, id, { atEnd: true });
        expect(await page.evaluate(() => window.__STEMMIO_TEST_NATIVE_CARET_RAF__.held.length)).toBeGreaterThan(0);
        if (releaseBeforeBlur) {
          await page.evaluate(() => window.__STEMMIO_TEST_NATIVE_CARET_RAF__.release());
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        }
        await target.evaluate(element => element.blur());
        await page.evaluate(() => window.__STEMMIO_TEST_NATIVE_CARET_RAF__.release());
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        // The same original element must retain focus and the latest caret;
        // waiting must not legitimize an earlier bookmark before the final X.
        await requireFrozenTextFocus(handle, id, { atEnd: true });
        await page.keyboard.press("Backspace");
        expect(await target.textContent()).toBe(before);
        await page.keyboard.press(keyShortcut("s"));
        await expect.poll(async () => (await readPublishedWorkingCopy(working, null)).toString())
          .toContain(" PRCORE_H02");
        expect((await readPublishedWorkingCopy(working, null)).toString()).not.toContain(" PRCORE_H02X");
      } finally {
        await page.evaluate(() => {
          window.__STEMMIO_TEST_NATIVE_CARET_RAF__?.release();
          delete window.__STEMMIO_TEST_NATIVE_CARET_RAF__;
        });
        await handle.dispose();
      }
    });
  });
}

test("a real Space key edits a nested summary instead of toggling its disclosure", async () => {
  const html = '<!doctype html><html><head><title>Summary space</title></head><body>'
    + '<details open data-native-case="summary-details">'
    + '<summary data-native-case="summary-space">Heading <span>nested</span></summary>'
    + '<p>body</p></details></body></html>';
  await withRuntimeProject("stemmio-summary-space-", { "runtime-report.html": html }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "summary-space");
    const working = await managedWorkingCopyPath(page, sourcePath);
    const target = frame.locator('[data-native-case="summary-space"]');
    const details = frame.locator('[data-native-case="summary-details"]');
    await activateNativeEdit(frame, "summary-space");
    await expect(target).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
    await page.keyboard.press(keyShortcut("ArrowDown"));
    await page.keyboard.type("A B");
    await expect(target).toContainText("nestedA B");
    await expect(details).toHaveAttribute("open", "");
    await expectCheckpointPersisted(page, 0);
    await expect.poll(() => readPublishedWorkingCopy(working, "utf8"))
      .toContain("nestedA B</span>");
  });
});

async function enableContinuityProbe(page) {
  await expect.poll(() => page.evaluate(() => ({
    editor: Boolean(document.querySelector('[data-testid="html-canvas-editor"]')),
    enable: typeof window.__STEMMIO_ENABLE_RUNTIME_CONTINUITY__,
  })), { timeout: 30_000 }).toEqual({
    editor: true,
    enable: "function",
  });
  await page.evaluate(() => window.__STEMMIO_ENABLE_RUNTIME_CONTINUITY__());
}

async function continuitySummary(page) {
  return page.evaluate(() => window.__STEMMIO_SUMMARIZE_RUNTIME_CONTINUITY__());
}

async function enterNativeEdit(page, frame, caseId, { scrollTop = 480 } = {}) {
  const reviewStage = page.locator(".review-scroll-stage");
  const target = frame.locator(`[data-native-case="${caseId}"]`);
  await target.click();
  await reviewStage.evaluate((element, nextTop) => {
    element.scrollTop = nextTop;
  }, scrollTop);
  await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(400);
  await activateNativeEdit(frame, caseId);
  await expect(target).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
  await target.press("End");
  return { reviewStage, target };
}

const STATIC_PAGE = `<!doctype html>
<html><head><title>Static continuity</title></head><body>
  <div aria-hidden="true" style="height:850px"></div>
  <main>
    <p data-native-case="continuity-static">静态页连续编辑不得替换 Runtime 文档。</p>
  </main>
  <div aria-hidden="true" style="height:1800px"></div>
</body></html>`;

test("frozen Inspector cache bounds response bodies without losing fetch data or network events", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const body = "synthetic-response-".repeat(8192);
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Access-Control-Allow-Origin": "*", "Content-Type": "text/plain" });
    response.end(body);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await withRuntimeProject("stemmio-inspector-cache-e2e-", { "runtime-report.html": STATIC_PAGE }, async ({ page }) => {
      await waitForRuntimeHandoffSettled(page);
      const endpoint = `http://127.0.0.1:${server.address().port}`;
      const fetchResponse = async suffix => {
        const url = `${endpoint}/${suffix}`;
        const [response, length] = await Promise.all([
          page.waitForResponse(r => r.url() === url),
          page.evaluate(async address => (await (await fetch(address)).text()).length, url),
        ]);
        expect(length).toBe(body.length); expect(response.status()).toBe(200);
        return response;
      };
      // The uncontrolled path retains the body; this would fail the bounded oracle.
      const before = await fetchResponse("unbounded");
      expect((await before.body()).length).toBe(body.length);
      const cache = await boundFrozenInspectorCache(page);
      const after = await fetchResponse("bounded");
      await expect(after.body()).rejects.toThrow(/evict|No resource|No data/u);
      cache.verify();
    });
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("frozen Inspector cache follows sandbox iframe replacement without accepting unbounded sessions", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  await withRuntimeProject("stemmio-inspector-sandbox-e2e-", { "runtime-report.html": STATIC_PAGE }, async ({ page }) => {
    await waitForRuntimeHandoffSettled(page);
    const cache = await boundFrozenInspectorCache(page);
    for (const text of ["first sandbox document", "replacement sandbox document"]) {
      await page.evaluate(content => {
        document.querySelector("#inspector-sandbox-proof")?.remove();
        const iframe = document.createElement("iframe");
        iframe.id = "inspector-sandbox-proof"; iframe.setAttribute("sandbox", "");
        iframe.srcdoc = `<p>${content}</p>`; document.body.append(iframe);
      }, text);
      await expect(page.frameLocator("#inspector-sandbox-proof").locator("p")).toHaveText(text);
      cache.verify();
    }
  });
});

test("frozen comment evidence accepts persisted comments beyond the virtual DOM window", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  test.setTimeout(90_000);
  await withRuntimeProject("stemmio-frozen-virtual-comments-", { "runtime-report.html": STATIC_PAGE }, async ({ page, sourcePath, relaunch }) => {
    await waitForRuntimeHandoffSettled(page);
    const frame = await currentEditorFrame(page), target = frame.locator('[data-native-case="continuity-static"]');
    const targetId = await target.getAttribute("data-stemmio-id");
    const workingPath = await managedWorkingCopyPath(page, sourcePath);
    const draftPath = path.join(path.dirname(workingPath), ".stemmio", "drafts", "work_ver_0001.json");
    const readComments = () => JSON.parse(readFileSync(draftPath, "utf8")).comments;
    const comments = [];
    for (let index = 1; index <= 41; index += 1) {
      await target.click();
      await page.getByRole("toolbar", { name: /编辑/u }).getByRole("button", { name: /留评论/u }).click();
      const text = `Fixed virtual comment ${index}`;
      await page.getByRole("textbox", { name: "评论内容" }).fill(text);
      await page.getByRole("button", { name: "评论", exact: true }).click();
      await expect.poll(() => existsSync(draftPath) ? readComments().length : 0).toBe(index);
      const matches = readComments().filter(comment => comment.text === text);
      expect(matches).toHaveLength(1);
      comments.push({ commentId: matches[0].commentId, text, targetId });
      await verifyFrozenCommentCard(page, comments.at(-1));
    }
    expect(await page.locator(".comment-card").count()).toBeLessThan(comments.length);
    expect(await verifyMixedComments(readComments, comments)).toHaveLength(41);
    await expect(verifyMixedComments(() => readComments().slice(1), comments)).rejects.toThrow("FROZEN_COMMENT_COLLECTION_MISMATCH");
    await expect(verifyMixedComments(readComments, comments.map((c, i) => i === 0 ? { ...c, targetId: "wrong-target" } : c)))
      .rejects.toThrow("FROZEN_COMMENT_IDENTITY_MISMATCH");
    const reopened = (await relaunch()).page;
    await waitForRuntimeHandoffSettled(reopened);
    expect(await verifyMixedComments(readComments, comments)).toHaveLength(41);
    await revealFrozenCommentCard(reopened, comments[0], true);
    await expect(verifyFrozenCommentCard(reopened, { ...comments[0], text: "deliberately wrong comment" })).rejects.toThrow();
    for (let index = 0; index < comments.length; index += 1) {
      const card = await revealFrozenCommentCard(reopened, comments[index], index === 0);
      await (await revealFrozenCommentDelete(card)).click({ timeout: 2_000 });
      await card.getByRole("button", { name: "删除", exact: true }).click({ timeout: 2_000 });
      await expect.poll(() => readComments().length).toBe(comments.length - index - 1);
    }
    expect(readComments()).toHaveLength(0);
  });
});

test("successful Candidate retirement does not retain a growing Document chain", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async ({}, testInfo) => {
  const source = '<!doctype html><html><head><title>Retirement memory</title></head><body><p data-native-case="retirement-copy">Fixed copy target</p><script>window.authoredReady=true;</script></body></html>';
  await withRuntimeProject("stemmio-retirement-memory-e2e-", { "runtime-report.html": source }, async ({ page, sourcePath }) => {
    await loadedDiskFrame(page, sourcePath, "retirement-copy");
    await disableStructuralInPlace(page);
    const editor = page.getByTestId("html-canvas-editor").filter({ visible: true });
    await waitForRuntimeHandoffSettled(page);
    const active = editor.frameLocator('iframe[data-runtime-slot-role="active"]');
    const id = await active.locator('[data-native-case="retirement-copy"]').getAttribute("data-stemmio-id");
    expect(id).toMatch(/^sm1_[a-f0-9]{32}$/u);
    const cdp = await page.context().newCDPSession(page);
    const samples = [];
    try {
      for (let cycle = 0; cycle < 4; cycle += 1) {
        const generation = Number(await editor.locator('iframe[data-runtime-slot-role="active"]').getAttribute("data-frame-generation"));
        await active.locator(`[data-stemmio-id="${id}"]`).click();
        await editor.getByRole("button", { name: "复制元素", exact: true }).click();
        await waitForRuntimeHandoffSettled(page, { priorGeneration: generation, requireGenerationAdvance: true });
        await expect(active.locator('[data-native-case="retirement-copy"]')).toHaveCount(cycle + 2);
        await cdp.send("HeapProfiler.collectGarbage");
        samples.push(await cdp.send("Memory.getDOMCounters"));
      }
      // Compare settled promotions, not cold startup. Two-slot replacement and
      // the current canonical source may overlap; historical frames must not accumulate.
      expect(samples[3].documents, JSON.stringify(samples)).toBeLessThanOrEqual(samples[0].documents + 2);
    } finally {
      await testInfo.attach("retirement-dom-counts", { body: JSON.stringify(samples), contentType: "application/json" });
      await cdp.detach();
    }
  }, {
    injectedEnv: {
      STEMMIO_E2E_RUNTIME_COMMIT_HOOKS: "1",
    },
  });
});

test("structural output owns direct comment, format, and delete-landing actions", {
  tag: ["@cap-canvas-editing"],
}, async () => {
  const source = `<!doctype html><html><head><title>Target handoff</title></head><body>
    <section data-native-case="handoff-parent">
      <p data-native-case="handoff-copy">副本前的原始文字</p>
      <p data-native-case="handoff-landing">删除后的落点</p>
    </section>
  </body></html>`;
  await withRuntimeProject("stemmio-structural-target-handoff-", {
    "runtime-report.html": source,
  }, async ({ page, sourcePath }) => {
    const { editor, frame } = await loadedDiskFrame(page, sourcePath, "handoff-copy");
    const working = await managedWorkingCopyPath(page, sourcePath);
    const readDraftComments = async () => {
      const response = await bridgeJson(page, `/workspace?sourcePath=${encodeURIComponent(working)}`);
      return response.body?.runtimeState?.draft?.comments
        || response.body?.activeDraft?.comments
        || [];
    };
    const original = frame.locator('[data-native-case="handoff-copy"]').first();
    const landing = frame.locator('[data-native-case="handoff-landing"]');
    const originalId = await original.getAttribute("data-stemmio-id");
    const landingId = await landing.getAttribute("data-stemmio-id");
    const originalText = await original.textContent();
    expect(originalId).toMatch(/^sm1_[a-f0-9]{32}$/u);
    expect(landingId).toMatch(/^sm1_[a-f0-9]{32}$/u);
    await original.click();

    await editor.getByRole("button", { name: "复制元素", exact: true }).click();
    await expect.poll(() => frame.locator('[data-native-case="handoff-copy"]').count()).toBe(2);
    const copyIds = await frame.locator('[data-native-case="handoff-copy"]')
      .evaluateAll(elements => elements.map(element => element.getAttribute("data-stemmio-id")));
    const copyId = copyIds.find(id => id && id !== originalId);
    expect(copyId).toMatch(/^sm1_[a-f0-9]{32}$/u);
    await expect(frame.locator("[data-html-canvas-selected]")).toHaveAttribute("data-stemmio-id", copyId);

    const copyCommentText = "副本评论不应回到原元素";
    await editor.getByRole("button", { name: /留评论/u }).click();
    const composer = page.getByRole("region", { name: "添加评论" });
    await composer.getByRole("textbox", { name: "评论内容" }).fill(copyCommentText);
    await composer.getByRole("button", { name: "评论", exact: true }).click();
    await expect.poll(async () => (await readDraftComments()).filter(comment => comment.text === copyCommentText))
      .toHaveLength(1);
    const copyComment = (await readDraftComments()).find(comment => comment.text === copyCommentText);
    expect(copyComment?.sourceAnchor).toMatchObject({ elementId: copyId, resolution: "exact" });

    // Enter the already selected copy through the toolbar; do not click the
    // copy again before selecting and applying the format.
    await editor.getByRole("button", { name: "编辑", exact: true }).click();
    const copy = frame.locator(`[data-stemmio-id="${copyId}"]`);
    await expect(copy).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
    await copy.press("End");
    await copy.press("Shift+Home");
    const bold = editor.getByRole("button", { name: "加粗", exact: true });
    await expect(bold).toBeEnabled();
    await bold.click();
    await page.keyboard.press("Escape");
    await page.keyboard.press(keyShortcut("s"));
    await expect.poll(() => readPublishedWorkingCopy(working, "utf8"))
      .toContain("font-weight: 700");
    const formattedSource = await readPublishedWorkingCopy(working, "utf8");
    expect(formattedSource).toContain(originalText);
    expect(formattedSource.match(/副本前的原始文字/gu)).toHaveLength(2);

    await expect(frame.locator("[data-html-canvas-selected]")).toHaveAttribute("data-stemmio-id", copyId);
    await page.once("dialog", dialog => dialog.accept());
    await editor.getByRole("button", { name: "删除元素", exact: true }).click();
    await expect.poll(() => frame.locator(`[data-stemmio-id="${copyId}"]`).count()).toBe(0);
    await expect(frame.locator("[data-html-canvas-selected]")).toHaveAttribute("data-stemmio-id", landingId);

    const landingCommentText = "删除后评论必须落在新落点";
    await editor.getByRole("button", { name: /留评论/u }).click();
    const landingComposer = page.getByRole("region", { name: "添加评论" });
    await landingComposer.getByRole("textbox", { name: "评论内容" }).fill(landingCommentText);
    await landingComposer.getByRole("button", { name: "评论", exact: true }).click();
    await expect.poll(async () => (await readDraftComments()).filter(comment => comment.text === landingCommentText))
      .toHaveLength(1);
    const landingComment = (await readDraftComments()).find(comment => comment.text === landingCommentText);
    expect(landingComment?.sourceAnchor).toMatchObject({ elementId: landingId, resolution: "exact" });
    expect((await readPublishedWorkingCopy(working, "utf8")).match(/副本前的原始文字/gu)).toHaveLength(1);
  });
});

const NESTED_SCROLL_PAGE = `<!doctype html>
<html><head><title>Nested scroll continuity</title></head><body>
  <div aria-hidden="true" style="height:850px"></div>
  <main>
    <div style="height:280px;overflow:auto;border:1px solid #ccc">
      <p data-native-case="continuity-nested">嵌套滚动页输入时评论栏宽度必须保持。</p>
      <div aria-hidden="true" style="height:1400px"></div>
    </div>
  </main>
  <div aria-hidden="true" style="height:1800px"></div>
</body></html>`;

const CHART_PAGE = `<!doctype html>
<html><head><title>Chart continuity</title></head><body>
  <div aria-hidden="true" style="height:850px"></div>
  <main>
    <p data-native-case="continuity-blank-caret">图表页空行必须落到对应 br，而不是最近文本。</p>
    <div id="chart" style="width:320px;height:180px"></div>
  </main>
  <div aria-hidden="true" style="height:1800px"></div>
  <script src="echarts.js"></script>
  <script>
    parent.__STEMMIO_BLANK_CARET_RUNTIME_COUNT__ =
      (parent.__STEMMIO_BLANK_CARET_RUNTIME_COUNT__ || 0) + 1;
    echarts.init(document.querySelector('#chart')).setOption({series:[{type:'bar',data:[1,2,3]}]});
  </script>
</body></html>`;

test("a restored save publication is not reported as a missing source after stale-hash reconcile", async () => {
  await withRuntimeProject("stemmio-continuity-publication-e2e-", {
    "runtime-report.html": STATIC_PAGE,
  }, async ({ page, electronApp, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "continuity-static");
    const { target } = await enterNativeEdit(page, frame, "continuity-static");
    const beforeDocument = await documentToken(page);
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    await page.evaluate(() => {
      window.__publicationWatchHints = [];
      window.stemmioProjects.onSourceFileChanged((hint) => window.__publicationWatchHints.push(hint));
    });
    await electronApp.evaluate(async ({ net }, source) => {
      const { rename } = process.getBuiltinModule("fs/promises");
      const path = process.getBuiltinModule("path");
      const parked = path.join(path.dirname(source), ".stemmio", "publication-race.html");
      const originalFetch = net.fetch.bind(net);
      let pending = true;
      net.fetch = async (...args) => {
        if (pending && new URL(String(args[0])).pathname === "/managed-working-copy/reconcile") {
          pending = false;
          // The queued Repository reply can reject the locator's old Hash
          // after the current save has already restored the visible path.
          await rename(parked, source);
          net.fetch = originalFetch;
          return new Response(JSON.stringify({ error: {
            code: "WORKING_COPY_CONFLICT", message: "stale pre-save hash",
          } }), { status: 409, headers: { "Content-Type": "application/json" } });
        }
        return originalFetch(...args);
      };
      await rename(source, parked);
    }, workingCopyPath);
    await expect.poll(() => page.evaluate(() => window.__publicationWatchHints.length))
      .toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__publicationWatchHints.every((hint) => hint.sourceMissing === false)))
      .toBe(true);
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(target).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
    await target.press("End");
    await page.keyboard.insertText("PUBLICATION_RECOVERED");
    await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
      .toContain("PUBLICATION_RECOVERED");
  });
});

test("continuous editing keeps the Runtime document through type, Enter, style and save", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const typed = `CONTINUITY_TRANSACTION_MARKER_${"x".repeat(68)}`;
  await withRuntimeProject("stemmio-continuity-static-e2e-", {
    "runtime-report.html": STATIC_PAGE,
  }, async ({ page, sourcePath, relaunch }) => {
    let { frame } = await loadedDiskFrame(page, sourcePath, "continuity-static");
    const { target } = await enterNativeEdit(page, frame, "continuity-static");
    await enableContinuityProbe(page);
    const beforeDocument = await documentToken(page);
    const beforeGeneration = await page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])')
      .getAttribute("data-frame-generation");

    await page.keyboard.insertText(typed);
    await expect(target).toContainText(typed);
    for (let index = 0; index < 20; index += 1) {
      await target.press("Enter");
    }
    await expect(target.locator(":scope > br")).toHaveCount(20);
    await target.evaluate((element) => {
      const node = Array.from(element.childNodes).find(
        (child) => child.nodeType === Node.TEXT_NODE && child.textContent?.includes("静态页连续编辑"),
      );
      if (!(node instanceof Text)) throw new Error("Original continuity sentence is missing.");
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, Math.min(4, node.data.length));
      const selection = document.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    const toolbar = page.getByTestId("html-canvas-editor").getByRole("toolbar");
    await toolbar.getByRole("button", { name: "加粗", exact: true }).click();
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8"))
      .toMatch(/font-weight:\s*700/u);
    await expectCheckpointPersisted(page, 0);
    await page.keyboard.press(keyShortcut("S"));
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])'))
      .toHaveAttribute("data-frame-generation", beforeGeneration);
    await expect(target).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
    const duringEdit = await continuitySummary(page);
    expect(duringEdit.frameCreated).toBe(0);
    expect(duringEdit.candidateCreated).toBe(0);

    const saved = readFileSync(workingCopyPath, "utf8");
    expect(saved).toContain(typed);
    expect(saved).toMatch(/font-weight:\s*700/u);
    const reopened = await relaunch();
    frame = (await loadedDiskFrame(reopened.page, workingCopyPath, "continuity-static")).frame;
    await expect(frame.locator('[data-native-case="continuity-static"]'))
      .toContainText(typed);
    expect(readFileSync(workingCopyPath, "utf8")).toContain(typed);
  });
});

test("continuous editing on a Script page keeps the Runtime document", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const typed = "DYNAMIC_CONTINUITY_MARKER";
  await withRuntimeProject("stemmio-continuity-dynamic-e2e-", {
    "runtime-report.html": CHART_PAGE,
    "echarts.js": ECHARTS_STUB,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "continuity-blank-caret");
    await expect(frame.locator("#chart canvas")).toHaveCount(1);
    const { target } = await enterNativeEdit(page, frame, "continuity-blank-caret");
    await enableContinuityProbe(page);
    const beforeDocument = await documentToken(page);
    const beforeGeneration = await page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])')
      .getAttribute("data-frame-generation");
    for (const character of typed) {
      await page.keyboard.insertText(character);
    }
    await expect(target).toContainText(typed);
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])'))
      .toHaveAttribute("data-frame-generation", beforeGeneration);
    const duringEdit = await continuitySummary(page);
    expect(duringEdit.frameCreated).toBe(0);
    expect(duringEdit.candidateCreated).toBe(0);
    expect(duringEdit.unexpectedCandidate).toBe(false);
  });
});

test("comment rail and canvas width stay visually continuous while typing in a nested scroller", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  await withRuntimeProject("stemmio-continuity-nested-e2e-", {
    "runtime-report.html": NESTED_SCROLL_PAGE,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "continuity-nested");
    const rail = page.locator(".review-scroll-stage > .comments-panel.comment-rail");
    await expect(rail).toBeVisible();
    const { target } = await enterNativeEdit(page, frame, "continuity-nested");
    await enableContinuityProbe(page);
    await expect.poll(() => page.evaluate(() => (
      window.__STEMMIO_READ_RUNTIME_CONTINUITY__?.()?.samples.length || 0
    ))).toBeGreaterThan(0);
    await page.keyboard.insertText("宽度连续");
    for (let index = 0; index < 8; index += 1) {
      await target.press("Enter");
    }
    await page.waitForFunction(() => {
      const samples = window.__STEMMIO_READ_RUNTIME_CONTINUITY__?.()?.samples || [];
      if (samples.length < 2) return false;
      return samples.at(-1).t - samples[0].t >= 500;
    });
    const summary = await continuitySummary(page);
    expect(summary.maxCanvasWidthDelta).toBeLessThanOrEqual(4);
    expect(summary.railDisappeared).toBe(false);
    expect(summary.jumpedToTop).toBe(false);
    expect(summary.missingVisibleFrame).toBe(false);
    expect(summary.frameCreated).toBe(0);
    expect(summary.candidateCreated).toBe(0);
    await expect(rail).toBeVisible();
  });
});

test("ending Runtime text editing keeps the document and the sixth blank-line caret", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const marker = "SIXTH_BLANK_LINE_MARKER";
  await withRuntimeProject("stemmio-continuity-blank-e2e-", {
    "runtime-report.html": CHART_PAGE,
    "echarts.js": ECHARTS_STUB,
  }, async ({ page, sourcePath }) => {
    let { frame } = await loadedDiskFrame(page, sourcePath, "continuity-blank-caret");
    await expect(frame.locator("#chart canvas")).toHaveCount(1);
    let { target } = await enterNativeEdit(page, frame, "continuity-blank-caret");
    await enableContinuityProbe(page);
    for (let index = 0; index < 8; index += 1) {
      await target.press("Enter");
    }
    await expect(target.locator(":scope > br")).toHaveCount(8);
    const duringEdit = await continuitySummary(page);
    expect(duringEdit.frameCreated).toBe(0);
    expect(duringEdit.candidateCreated).toBe(0);
    const beforeDocument = await documentToken(page);
    const beforeGeneration = await page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])')
      .getAttribute("data-frame-generation");
    const beforeScriptCount = await page.evaluate(() => (
      window.__STEMMIO_BLANK_CARET_RUNTIME_COUNT__ || 0
    ));

    await page.keyboard.press("Escape");
    await expect(target).not.toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
    await page.waitForTimeout(900);
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(page.getByTestId("html-canvas-editor")
      .locator('iframe:not([data-frame-role])'))
      .toHaveAttribute("data-frame-generation", beforeGeneration);
    expect(await page.evaluate(() => (
      window.__STEMMIO_BLANK_CARET_RUNTIME_COUNT__ || 0
    ))).toBe(beforeScriptCount);
    const afterBoundary = await continuitySummary(page);
    expect(afterBoundary.frameCreated).toBe(0);
    expect(afterBoundary.framePromoted).toBe(0);
    expect(afterBoundary.candidateCreated).toBe(0);
    frame = await currentEditorFrame(page);
    target = frame.locator('[data-native-case="continuity-blank-caret"]');
    await expect(target.locator(":scope > br")).toHaveCount(8);
    const sixthBreak = await target.evaluate((element) => {
      const breaks = [...element.querySelectorAll(":scope > br")];
      if (breaks.length < 6) {
        throw new Error(`Need six blank lines, found ${breaks.length}.`);
      }
      const br = breaks[5];
      const range = document.createRange();
      range.setStartBefore(br);
      range.setEndAfter(br);
      const glyph = range.getBoundingClientRect();
      const host = element.getBoundingClientRect();
      const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 24;
      const fallbackY = lineHeight * 5 + lineHeight / 2;
      return {
        x: glyph.width >= 1 ? glyph.left - host.left + Math.max(4, glyph.width / 2) : 8,
        y: glyph.height >= 1 ? glyph.top - host.top + Math.max(2, glyph.height / 2) : fallbackY,
      };
    });
    await target.dblclick({ position: sixthBreak });
    await expect(target).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
    await page.keyboard.insertText(marker);
    await expect(target).toContainText(marker);
    const workingCopyPath = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(() => readPublishedWorkingCopy(workingCopyPath, "utf8")).toContain(marker);
    const inner = readFileSync(workingCopyPath, "utf8").match(
      /data-native-case="continuity-blank-caret"[^>]*>([\s\S]*?)<\/p>/u,
    )?.[1] ?? "";
    expect(inner).toContain(marker);
    expect(inner).not.toMatch(/^\s*SIXTH_BLANK_LINE_MARKER/u);
    expect(inner).not.toMatch(/对应 br，而不是最近文本。SIXTH_BLANK_LINE_MARKER/u);
    const beforeMarker = inner.slice(0, inner.indexOf(marker));
    expect((beforeMarker.match(/<br\b/giu) || []).length).toBe(5);
  });
});

const DELAYED_CHART_PAGE = `<!doctype html><html><head><title>Continuous report</title>
<style>body{font:18px system-ui;padding:32px;color:#25232a}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}#chart{height:180px}canvas{width:320px;height:180px}</style></head>
<body><h1>Quarterly report</h1><main><p data-native-case="format-chart">Revenue grew steadily this quarter.</p><div id="chart"></div></main>
<script>
 parent.__STEMMIO_DELAYED_CHART_RUNTIME_COUNT__ =
   (parent.__STEMMIO_DELAYED_CHART_RUNTIME_COUNT__ || 0) + 1;
 if (parent.__STEMMIO_RUNTIME_FAILURE_EVIDENCE__) {
   const events = parent.__STEMMIO_RUNTIME_RECOVERY_EVENTS__ ||= [];
   events.push({ kind: 'execute', executionId: crypto.randomUUID(),
     time: parent.performance.timeOrigin + parent.performance.now(),
     count: parent.__STEMMIO_DELAYED_CHART_RUNTIME_COUNT__,
     generation: frameElement?.getAttribute('data-frame-generation'),
     candidate: frameElement?.getAttribute('data-runtime-candidate-id') });
   if (events.length > 128) events.shift();
 }
 const text = document.querySelector('[data-native-case="format-chart"]').textContent;
 if (text.includes('FAIL_CHART')) {
   parent.__STEMMIO_DELAYED_CHART_FAILURE_COUNT__ =
     (parent.__STEMMIO_DELAYED_CHART_FAILURE_COUNT__ || 0) + 1;
   throw new Error('synthetic chart initialization failure');
 }
 setTimeout(() => {
   const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=180;
   document.querySelector('#chart').append(canvas);
   const ctx = canvas.getContext('2d'); ctx.fillStyle='#6054d9';
   [70,120,155].forEach((height,index)=>ctx.fillRect(20+index*95,180-height,60,height));
 }, text.includes('UPDATED') ? 700 : 30);
</script></body></html>`;

test("formatting preserves charts without an edit-boundary Runtime rebuild", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async ({}, testInfo) => {
  await withRuntimeProject("stemmio-chart-format-e2e-", { "runtime-report.html": DELAYED_CHART_PAGE }, async ({ page, sourcePath }) => {
    let { frame } = await loadedDiskFrame(page, sourcePath, "format-chart");
    await expect(frame.locator('#chart canvas')).toHaveCount(1);
    const editor = page.getByTestId('html-canvas-editor');
    const generation = await editor.locator('iframe[data-runtime-slot-role="active"]').getAttribute('data-frame-generation');
    const beforeDocument = await documentToken(page);
    const beforeScriptCount = await page.evaluate(() => (
      window.__STEMMIO_DELAYED_CHART_RUNTIME_COUNT__ || 0
    ));
    await activateNativeEdit(frame, 'format-chart');
    const target = frame.locator('[data-native-case="format-chart"]');
    await target.press('End');
    await page.keyboard.insertText(' UPDATED');
    await target.press('Home');
    await target.press('Shift+End');
    for (const name of ['加粗', '下划线', '加粗', '下划线']) {
      await editor.getByRole('button', { name, exact: true }).click();
      await expect(frame.locator('#chart canvas')).toHaveCount(1);
      expect(await frame.locator('#chart canvas').evaluate((canvas) => canvas.getContext('2d').getImageData(30,160,1,1).data[3])).toBe(255);
      await expect(editor.locator('iframe[data-runtime-slot-role="active"]')).toHaveAttribute('data-frame-generation', generation);
    }
    await page.evaluate(() => {
      window.__chartContinuitySamples = [];
      window.__chartContinuityTimer = setInterval(() => {
        const frame = document.querySelector('iframe[data-runtime-slot-role="active"]');
        if (frame?.contentDocument) window.__chartContinuitySamples.push(frame.contentDocument.querySelectorAll('#chart canvas').length);
      }, 16);
    });
    await page.keyboard.press('Escape');
    await page.keyboard.press(keyShortcut('s'));
    await page.waitForTimeout(1_100);
    await expect(editor.locator('iframe[data-runtime-slot-role="active"]')).toHaveAttribute('data-frame-generation', generation);
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    expect(await page.evaluate(() => (
      window.__STEMMIO_DELAYED_CHART_RUNTIME_COUNT__ || 0
    ))).toBe(beforeScriptCount);
    await expect(editor).not.toHaveAttribute('data-runtime-refresh-pending', '');
    frame = await currentEditorFrame(page);
    await expect(frame.locator('#chart canvas')).toHaveCount(1);
    const samples = await page.evaluate(() => { clearInterval(window.__chartContinuityTimer); return window.__chartContinuitySamples; });
    expect(samples.length).toBeGreaterThan(1);
    expect(samples.every((count) => count === 1)).toBe(true);
    const working = await managedWorkingCopyPath(page, sourcePath);
    expect(await readPublishedWorkingCopy(working, 'utf8')).toContain('UPDATED');
    await page.screenshot({ path: testInfo.outputPath('chart-format-continuity.png') });
  });
});

test("failed chart refresh keeps the latest static source quietly editable across repeated retries", async ({}, testInfo) => {
  await withRuntimeProject("stemmio-chart-failure-e2e-", { "runtime-report.html": DELAYED_CHART_PAGE }, async ({ page, sourcePath }) => {
    let { frame } = await loadedDiskFrame(page, sourcePath, 'format-chart');
    const editor = page.getByTestId('html-canvas-editor').filter({ visible: true }).first();
    await expect(frame.locator('#chart canvas')).toHaveCount(1);
    await disableStructuralInPlace(page);
    await activateNativeEdit(frame, 'format-chart');
    await frame.locator('[data-native-case="format-chart"]').press('End');
    await page.keyboard.insertText(' FAIL_CHART');
    await page.keyboard.press('Escape');
    const working = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(() => readPublishedWorkingCopy(working, 'utf8')).toContain('FAIL_CHART');
    await expect(frame.locator('#chart canvas')).toHaveCount(1);
    const failuresBeforeFirstRetry = await page.evaluate(() => (
      window.__STEMMIO_DELAYED_CHART_FAILURE_COUNT__ || 0
    ));
    await editor.getByRole('button', { name: '复制元素', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (
      window.__STEMMIO_DELAYED_CHART_FAILURE_COUNT__ || 0
    )), { timeout: 12_000 }).toBeGreaterThan(failuresBeforeFirstRetry);
    await expect(page.getByTestId('edit-runtime-static-fallback')).toHaveCount(0);
    await expect(editor).toHaveAttribute(
      'data-runtime-degradation',
      'static-visible',
      { timeout: EDIT_AUTHOR_RUNTIME_BUDGET.runtimeSurfaceDeadlineMs + 8_000 },
    );
    await expect(editor).toHaveAttribute('data-runtime-surface-budget', 'exceeded');
    await expect(editor).toHaveAttribute('aria-readonly', 'false');
    frame = await currentEditorFrame(page);
    await expect(frame.locator('#chart canvas')).toHaveCount(0);

    let target = frame.locator('[data-native-case="format-chart"]').first();
    await doubleClickRenderedText(target);
    await expect(target).toHaveAttribute('contenteditable', 'true');
    await target.press('End');
    await page.keyboard.insertText('        CONTINUED');
    await page.keyboard.press(keyShortcut('s'));
    await page.keyboard.press('Escape');
    await expect.poll(() => readPublishedWorkingCopy(working, 'utf8')).toContain('CONTINUED');
    await expect(editor).toHaveAttribute('aria-readonly', 'false');

    const failuresBeforeRetry = await page.evaluate(() => (
      window.__STEMMIO_DELAYED_CHART_FAILURE_COUNT__ || 0
    ));
    await page.getByRole('button', { name: '更多', exact: true }).click();
    await page.getByRole('menuitem', { name: '重新加载动态内容', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (
      window.__STEMMIO_DELAYED_CHART_FAILURE_COUNT__ || 0
    )), { timeout: 12_000 }).toBeGreaterThan(failuresBeforeRetry);
    await expect(editor).toHaveAttribute(
      'data-runtime-degradation',
      'static-visible',
      { timeout: EDIT_AUTHOR_RUNTIME_BUDGET.runtimeSurfaceDeadlineMs + 8_000 },
    );
    await expect(editor).toHaveAttribute('aria-readonly', 'false');
    frame = await currentEditorFrame(page);
    target = frame.locator('[data-native-case="format-chart"]').first();
    await doubleClickRenderedText(target);
    await expect(target).toHaveAttribute('contenteditable', 'true');
    await target.press('End');
    await page.keyboard.insertText(' STILL_EDITABLE');
    await page.keyboard.press('Escape');
    await expect.poll(() => readPublishedWorkingCopy(working, 'utf8')).toContain('STILL_EDITABLE');
    await page.screenshot({ path: testInfo.outputPath('chart-failed-refresh-editable.png') });
  }, {
    injectedEnv: {
      STEMMIO_E2E_RUNTIME_COMMIT_HOOKS: "1",
    },
  });
});

const HIDDEN_TAB_CHART_PAGE = `<!doctype html><html><head><title>Tabbed report</title>
<style>body{font:18px system-ui;padding:32px}.panel[hidden]{display:none}#chart{width:500px;height:240px}</style>
<script src="echarts.js"></script></head><body>
<nav role="tablist"><button role="tab" aria-controls="overview" aria-selected="true" class="tab" data-p="overview">Overview</button><button role="tab" aria-controls="details" aria-selected="false" class="tab" data-p="details">Details</button></nav>
<section role="tabpanel" id="overview" class="panel"><p data-native-case="overview-copy">Report overview</p></section>
<section role="tabpanel" id="details" class="panel" hidden><p data-native-case="hidden-chart-copy">Revenue grew this quarter.</p><div id="chart"></div></section>
<script>
parent.__STEMMIO_HIDDEN_CHART_RUNTIME_COUNT__ =
 (parent.__STEMMIO_HIDDEN_CHART_RUNTIME_COUNT__ || 0) + 1;
const chart = echarts.init(document.querySelector('#chart'));
chart.setOption({animation:false,xAxis:{data:['A','B']},yAxis:{},series:[{type:'bar',data:[30,60]}]});
window.addEventListener('resize',()=>chart.resize());
</script></body></html>`;

test("an active hidden tab keeps chart geometry without ordinary edit promotion", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async ({}, testInfo) => {
  await withRuntimeProject('stemmio-hidden-chart-e2e-', {
    'runtime-report.html': HIDDEN_TAB_CHART_PAGE,
    'echarts.js': readFileSync(new URL('../../../node_modules/echarts/dist/echarts.min.js', import.meta.url), 'utf8'),
  }, async ({ page, sourcePath }) => {
    let { frame, editor } = await loadedDiskFrame(page, sourcePath, 'overview-copy');
    await expect(frame.locator('#chart canvas')).toHaveCount(1);
    await frame.locator('.tab[data-p="details"]').click();
    await editor.getByRole('button', { name: '切换到此页签', exact: true }).click();
    frame = await currentEditorFrame(page);
    await expect(frame.locator('#details')).toBeVisible();
    const chartWidth = () => frame.locator('#chart canvas').first().evaluate(canvas => canvas.width);
    await expect.poll(chartWidth).toBeGreaterThan(400);
    const initialDocument = await documentToken(page);
    const initialGeneration = await editor.locator('iframe[data-runtime-slot-role="active"]')
      .getAttribute('data-frame-generation');
    const initialScriptCount = await page.evaluate(() => (
      window.__STEMMIO_HIDDEN_CHART_RUNTIME_COUNT__ || 0
    ));
    for (const marker of [' First edit.', ' Second edit.']) {
      await activateNativeEdit(frame, 'hidden-chart-copy');
      await frame.locator('[data-native-case="hidden-chart-copy"]').press('End');
      await page.keyboard.insertText(marker);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(700);
      await expect(editor.locator('iframe[data-runtime-slot-role="active"]')).toHaveAttribute('data-frame-generation', initialGeneration);
      await expect.poll(() => documentToken(page)).toBe(initialDocument);
      expect(await page.evaluate(() => (
        window.__STEMMIO_HIDDEN_CHART_RUNTIME_COUNT__ || 0
      ))).toBe(initialScriptCount);
      await expect(editor).not.toHaveAttribute('data-runtime-refresh-pending', '');
      frame = await currentEditorFrame(page);
      await expect(frame.locator('#details')).toBeVisible();
      await expect.poll(chartWidth).toBeGreaterThan(400);
      await expect(page.getByTestId('edit-runtime-static-fallback')).toHaveCount(0);
    }
    await page.screenshot({ path: testInfo.outputPath('restored-tab-chart.png') });
  });
});


test("owned composition snapshots keep formatted source nodes editable but author clones stay comment-only", {
  tag: ["@cap-canvas-editing"],
}, async ({}, testInfo) => {
  const source = DELAYED_CHART_PAGE.replace("Revenue grew steadily this quarter.", "Revenue <strong>grew steadily</strong> this quarter.");
  await withRuntimeProject("stemmio-owned-snapshot-e2e-", { "runtime-report.html": source }, async ({ page, sourcePath }) => {
    await loadedDiskFrame(page, sourcePath, "format-chart");
    const editor = page.getByTestId("html-canvas-editor");
    const frame = editor.frameLocator('iframe[data-runtime-slot-role="active"]');
    const paragraph = frame.locator('[data-native-case="format-chart"]');
    await expect(frame.locator('#chart canvas')).toHaveCount(1);
    await doubleClickRenderedText(paragraph);
    await expect(paragraph).toHaveAttribute("contenteditable", "true");
    await paragraph.press(keyShortcut("ArrowRight"));
    await paragraph.dispatchEvent("compositionstart", { data: "" });
    await paragraph.dispatchEvent("compositionend", { data: "续写" });
    await paragraph.press(keyShortcut("ArrowLeft"));
    for (let i = 0; i < 7; i += 1) await page.keyboard.press("Shift+ArrowRight");
    await editor.getByRole("button", { name: "加粗", exact: true }).click();
    await doubleClickRenderedText(paragraph.locator("strong"));
    await expect(editor.getByRole("button", { name: "斜体", exact: true })).toBeVisible();
    await editor.getByRole("button", { name: "斜体", exact: true }).click();
    await paragraph.press(keyShortcut("ArrowRight"));
    await page.keyboard.insertText(" CONTINUED");
    await page.keyboard.press(keyShortcut("s"));
    const working = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(async () => await readPublishedWorkingCopy(working, "utf8")).toContain("CONTINUED");
    const activeGeneration = await editor.locator('iframe[data-runtime-slot-role="active"]').getAttribute('data-frame-generation');
    const activeDocument = await documentToken(page);
    const activeScriptCount = await page.evaluate(() => (
      window.__STEMMIO_DELAYED_CHART_RUNTIME_COUNT__ || 0
    ));
    await page.keyboard.press("Escape");
    await expect(paragraph).not.toHaveAttribute("contenteditable", "true");
    await page.waitForTimeout(900);
    await expect(editor.locator('iframe[data-runtime-slot-role="active"]')).toHaveAttribute('data-frame-generation', activeGeneration);
    await expect.poll(() => documentToken(page)).toBe(activeDocument);
    expect(await page.evaluate(() => (
      window.__STEMMIO_DELAYED_CHART_RUNTIME_COUNT__ || 0
    ))).toBe(activeScriptCount);
    // Both physical slots persist, but an ordinary successful text/style edit
    // leaves the second slot empty instead of preparing a deferred Candidate.
    await expect(editor.locator('iframe[data-runtime-slot-role="inactive"]')).toHaveCount(1);
    await expect(editor.locator('iframe[data-runtime-slot-role="candidate"]')).toHaveCount(0);
    await expect(editor).toHaveAttribute('data-render-verified', 'true');
    // Public attributes and source-identical bytes cannot grant authority.
    await paragraph.evaluate((node) => {
      const clone = node.cloneNode(true);
      clone.setAttribute("data-untrusted-copy", "true");
      node.after(clone);
    });
    await frame.locator('[data-untrusted-copy] strong').first().click();
    await expect(editor.getByRole("button", { name: "加粗", exact: true })).toHaveCount(0);
    await expect(editor.getByRole("button", { name: /评论/ })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("owned-snapshot-authority.png") });
  });
});

test("the read-only recovery notice reloads source authority even when dynamic preparation fails", async ({}, testInfo) => {
  await withRuntimeProject("stemmio-static-reload-e2e-", { "runtime-report.html": DELAYED_CHART_PAGE }, async ({ page, electronApp, sourcePath }) => {
    const armedAt = await page.evaluate(() => (
      window.__STEMMIO_RUNTIME_FAILURE_EVIDENCE__?.armedAt || null
    ));
    expect(armedAt).toEqual(expect.any(Number));
    await openRecentProject(page, sourcePath, "format-chart");
    const initialRuntimeCount = await page.evaluate(() => (
      window.__STEMMIO_DELAYED_CHART_RUNTIME_COUNT__ || 0
    ));
    expect(initialRuntimeCount).toBeGreaterThan(0);
    expect(await page.evaluate(() => performance.timeOrigin + performance.now()))
      .toBeGreaterThan(armedAt);
    await disableStructuralInPlace(page);
    const editor = page.getByTestId('html-canvas-editor');
    const frame = editor.frameLocator('iframe[data-runtime-slot-role="active"]');
    const target = frame.locator('[data-native-case="format-chart"]').first();
    await expect(frame.locator('#chart canvas')).toHaveCount(1);
    await doubleClickRenderedText(target);
    await expect(target).toHaveAttribute('contenteditable', 'true');
    await target.press(keyShortcut('ArrowRight'));
    await page.keyboard.insertText(' FAIL_CHART');
    await page.keyboard.press('Escape');
    const failuresBeforeReload = await page.evaluate(() => (
      window.__STEMMIO_DELAYED_CHART_FAILURE_COUNT__ || 0
    ));
    await editor.getByRole('button', { name: '复制元素', exact: true }).click();
    await expect.poll(() => page.evaluate(() => (
      window.__STEMMIO_DELAYED_CHART_FAILURE_COUNT__ || 0
    )), { timeout: 12_000 }).toBeGreaterThan(failuresBeforeReload);
    await expect(editor).toHaveAttribute('aria-readonly', 'true', { timeout: 20_000 });
    await expect(page.getByTestId('edit-runtime-static-fallback')).toContainText('页面暂时无法编辑');
    const working = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(() => readPublishedWorkingCopy(working)).toContain('FAIL_CHART');
    const activeFrame = editor.locator('iframe[data-runtime-slot-role="active"]');
    await activeFrame.evaluate((frame) => {
      window.__M5_BEFORE_AUTHORITY_CONTENT_DOCUMENT__ = frame.contentDocument;
    });
    // A second, independent failure during reload used to retain the previous
    // runtime's read-only flag forever, despite a verified static document.
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('html-edit-runtime:prepare');
      ipcMain.handle('html-edit-runtime:prepare', () => { throw new Error('synthetic preparation unavailable'); });
    });
    await page.getByTestId('edit-runtime-static-fallback')
      .getByRole('button', { name: '重新载入当前 HTML', exact: true }).click();
    await expect(page.locator('.workbench-chrome-status')).toHaveText(
      '页面已重新加载，可以继续编辑',
      { timeout: EDIT_AUTHOR_RUNTIME_BUDGET.runtimeSurfaceDeadlineMs + 8_000 },
    );
    await expect(editor).toHaveAttribute('aria-readonly', 'false');
    await expect(page.getByTestId('edit-runtime-static-fallback')).toHaveCount(0);
    await expect.poll(() => activeFrame.evaluate((frame) => Boolean(
      frame.contentDocument
      && frame.contentDocument !== window.__M5_BEFORE_AUTHORITY_CONTENT_DOCUMENT__
    ))).toBe(true);
    await doubleClickRenderedText(target);
    await expect(target).toHaveAttribute('contenteditable', 'true');
    await target.press(keyShortcut('ArrowRight'));
    await page.keyboard.insertText(' RECOVERED');
    await page.keyboard.press(keyShortcut('s'));
    await expect.poll(() => readPublishedWorkingCopy(working)).toContain('RECOVERED');
    await expect.poll(() => page.evaluate(() => (
      window.__STEMMIO_DELAYED_CHART_RUNTIME_COUNT__ || 0
    ))).toBeGreaterThan(initialRuntimeCount);
    const runtimeEvidence = await page.evaluate(() => (
      window.__STEMMIO_RUNTIME_FAILURE_EVIDENCE__?.read() || null
    ));
    expect(runtimeEvidence?.authorCounts?.recovery).toBeGreaterThanOrEqual(initialRuntimeCount);
    expect(runtimeEvidence.recoveryEvents[0].time).toBeGreaterThanOrEqual(armedAt);
    expect(new Set(runtimeEvidence.recoveryEvents.map(event => event.executionId)).size)
      .toBe(runtimeEvidence.authorCounts.recovery);
    const observedGenerations = (runtimeEvidence?.entries || []).flatMap((entry) => (
      entry.data?.frames || []
    )).map((frame) => frame["data-frame-generation"]).filter(Boolean);
    expect(observedGenerations.length).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath('reload-editing-restored.png') });
  }, {
    injectedEnv: {
      STEMMIO_E2E_RUNTIME_COMMIT_HOOKS: "1",
      STEMMIO_E2E_STATIC_CANDIDATE_FAILURE: "1",
    },
  }, { testInfo, caseId: "format-chart" });
});

test("Canvas shortcuts follow the promoted frame and same-source reload keeps charts running", async ({}, testInfo) => {
  await withRuntimeProject("stemmio-history-focus-e2e-", { "runtime-report.html": DELAYED_CHART_PAGE }, async ({ page, sourcePath }) => {
    await loadedDiskFrame(page, sourcePath, "format-chart");
    const editor = page.getByTestId("html-canvas-editor");
    const frame = editor.frameLocator('iframe[data-runtime-slot-role="active"]');
    const target = frame.locator('[data-native-case="format-chart"]');
    const working = await managedWorkingCopyPath(page, sourcePath);
    await doubleClickRenderedText(target);
    await target.press(keyShortcut("ArrowLeft"));
    for (let i = 0; i < 6; i += 1) await page.keyboard.press("Shift+ArrowRight");
    await editor.getByRole("button", { name: "加粗", exact: true }).click();
    await target.press(keyShortcut("ArrowRight"));
    await page.keyboard.insertText(" HISTORY_CONTINUITY");
    await page.keyboard.press(keyShortcut("s"));
    await expect.poll(() => readPublishedWorkingCopy(working)).toContain("HISTORY_CONTINUITY");
    const generation = await editor.locator('iframe[data-runtime-slot-role="active"]').getAttribute("data-frame-generation");
    await page.keyboard.press(keyShortcut("z"));
    await expect.poll(() => readPublishedWorkingCopy(working)).not.toContain("HISTORY_CONTINUITY");
    // No extra click or history-settlement wait: a distinct Redo arriving
    // during Undo's save/acknowledgement must execute after it, not disappear.
    await page.keyboard.press(keyShortcut("Shift+z"));
    await expect.poll(() => readPublishedWorkingCopy(working)).toContain("HISTORY_CONTINUITY");
    // The verified editable-island history path stays in the current Document;
    // Redo must not consume a deferred whole-page Runtime refresh.
    await expect.poll(() => editor.locator('iframe[data-runtime-slot-role="active"]')
      .getAttribute("data-frame-generation")).toBe(generation);
    await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute("data-runtime-slot-role"))).toBe("active");
    await expect(editor).toHaveAttribute("data-runtime-activation", "activation-ready");
    await expect(editor).not.toHaveAttribute("data-runtime-candidate-id", /.+/u);
    await expect(editor).not.toHaveAttribute("data-runtime-refresh-pending", "");
    const activeFrame = editor.locator('iframe[data-runtime-slot-role="active"]');
    const beforeReloadDocument = await documentToken(page);
    const beforeReloadScriptCount = await page.evaluate(() => (
      window.__STEMMIO_DELAYED_CHART_RUNTIME_COUNT__ || 0
    ));
    const beforeReloadLastKnownGood = await editor.getAttribute(
      "data-runtime-last-known-good-id",
    );
    await activeFrame.evaluate((frame) => {
      window.__M5_BEFORE_SAME_BYTE_AUTHORITY_CONTENT_DOCUMENT__ = frame.contentDocument;
    });
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: "从磁盘重新载入 HTML", exact: true }).click();
    await expect(page.locator(".workbench-chrome-status")).toHaveText("页面已重新加载，可以继续编辑");
    await expect.poll(() => page.evaluate(() => (
      window.__STEMMIO_DELAYED_CHART_RUNTIME_COUNT__ || 0
    ))).toBe(beforeReloadScriptCount + 1);
    await expect.poll(() => documentToken(page)).not.toBe(beforeReloadDocument);
    await expect.poll(() => activeFrame.evaluate((frame) => Boolean(
      frame.contentDocument
      && frame.contentDocument !== window.__M5_BEFORE_SAME_BYTE_AUTHORITY_CONTENT_DOCUMENT__
    ))).toBe(true);
    await expect(editor).toHaveAttribute("data-runtime-activation", "activation-ready");
    await expect(editor).not.toHaveAttribute("data-runtime-candidate-id", /.+/u);
    await expect.poll(() => editor.getAttribute("data-runtime-last-known-good-id"))
      .not.toBe(beforeReloadLastKnownGood);
    await expect.poll(() => frame.locator("#chart canvas").evaluateAll(canvases => canvases.filter(canvas => (
      canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0)
    )).length)).toBe(1);
    await doubleClickRenderedText(target);
    await expect(target).toHaveAttribute("contenteditable", "true");
    await page.screenshot({ path: testInfo.outputPath("history-focus-and-reload-chart.png") });
  });
});

test("a layout-safe format refusal keeps the Runtime text session active", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const source = `<!doctype html><html><head><title>Flex format refusal</title></head><body>
  <p style="display:inline-flex;gap:8px" data-native-case="flex-format-refusal">Flexible source text</p>
  <script>
    parent.__STEMMIO_FLEX_FORMAT_RUNTIME_COUNT__ =
      (parent.__STEMMIO_FLEX_FORMAT_RUNTIME_COUNT__ || 0) + 1;
  </script></body></html>`;
  await withRuntimeProject("stemmio-flex-format-refusal-e2e-", {
    "runtime-report.html": source,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "flex-format-refusal");
    const editor = page.getByTestId("html-canvas-editor");
    const target = frame.locator('[data-native-case="flex-format-refusal"]');
    const beforeDocument = await documentToken(page);
    const beforeGeneration = await editor.locator('iframe[data-runtime-slot-role="active"]')
      .getAttribute("data-frame-generation");
    const beforeScriptCount = await page.evaluate(() => (
      window.__STEMMIO_FLEX_FORMAT_RUNTIME_COUNT__ || 0
    ));

    await activateNativeEdit(frame, "flex-format-refusal");
    await target.evaluate((element) => {
      const text = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      if (!(text instanceof Text) || text.data.length < 4) {
        throw new Error("Flex formatting fixture text is missing.");
      }
      const range = element.ownerDocument.createRange();
      range.setStart(text, text.data.length - 4);
      range.setEnd(text, text.data.length);
      const selection = element.ownerDocument.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.ownerDocument.dispatchEvent(new Event("selectionchange"));
    });
    const bold = editor.getByRole("button", { name: "加粗", exact: true });
    await expect(bold).toBeEnabled();
    await bold.click();
    await expect(editor).toHaveAttribute(
      "data-native-format-resume",
      "rejected:requested:resumed",
    );
    await expect(target).toHaveAttribute("contenteditable", "true");
    await target.press("End");
    await page.keyboard.insertText(" STILL_TYPING_AFTER_REFUSAL");
    await page.keyboard.press(keyShortcut("s"));
    const working = await managedWorkingCopyPath(page, sourcePath);
    await expect.poll(() => readPublishedWorkingCopy(working, "utf8"))
      .toContain("STILL_TYPING_AFTER_REFUSAL");
    expect(await readPublishedWorkingCopy(working, "utf8")).not.toMatch(/font-weight\s*:/u);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(800);
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(editor.locator('iframe[data-runtime-slot-role="active"]'))
      .toHaveAttribute("data-frame-generation", beforeGeneration);
    expect(await page.evaluate(() => (
      window.__STEMMIO_FLEX_FORMAT_RUNTIME_COUNT__ || 0
    ))).toBe(beforeScriptCount);
    await expect(editor).not.toHaveAttribute("data-runtime-refresh-pending", "");
  });
});

test("a partial background fill refusal validates the Kernel result before publication", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const source = `<!doctype html><html><head><title>Background format refusal</title></head><body>
  <p data-native-case="background-format-refusal">Background source text</p>
  <script>
    parent.__STEMMIO_BACKGROUND_FORMAT_RUNTIME_COUNT__ =
      (parent.__STEMMIO_BACKGROUND_FORMAT_RUNTIME_COUNT__ || 0) + 1;
  </script></body></html>`;
  await withRuntimeProject("stemmio-background-format-refusal-e2e-", {
    "runtime-report.html": source,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "background-format-refusal");
    const editor = page.getByTestId("html-canvas-editor");
    const target = frame.locator('[data-native-case="background-format-refusal"]');
    const beforeDocument = await documentToken(page);
    const beforeGeneration = await editor.locator('iframe[data-runtime-slot-role="active"]')
      .getAttribute("data-frame-generation");
    const beforeScriptCount = await page.evaluate(() => (
      window.__STEMMIO_BACKGROUND_FORMAT_RUNTIME_COUNT__ || 0
    ));

    await activateNativeEdit(frame, "background-format-refusal");
    await target.evaluate((element) => {
      const text = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
      if (!(text instanceof Text) || text.data.length < 10) {
        throw new Error("Background formatting fixture text is missing.");
      }
      const range = element.ownerDocument.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 10);
      const selection = element.ownerDocument.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
      element.ownerDocument.dispatchEvent(new Event("selectionchange"));
    });
    await editor.getByText("样式与间距", { exact: true }).click();
    const fill = editor.getByLabel("元素填充色");
    await expect(fill).toBeEnabled();
    await fill.evaluate((element) => {
      if (!(element instanceof HTMLInputElement)) throw new Error("Fill input is missing.");
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(element, "#ff0000");
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(editor).toHaveAttribute(
      "data-native-format-resume",
      "rejected:requested:resumed",
    );
    await expect(target).toHaveAttribute("contenteditable", "true");
    const working = await managedWorkingCopyPath(page, sourcePath);
    expect(await readPublishedWorkingCopy(working, "utf8"))
      .not.toMatch(/background-color\s*:/u);
    await target.press("End");
    await page.keyboard.insertText(" STILL_TYPING_AFTER_BACKGROUND_REFUSAL");
    await page.keyboard.press(keyShortcut("s"));
    await expect.poll(() => readPublishedWorkingCopy(working, "utf8"))
      .toContain("STILL_TYPING_AFTER_BACKGROUND_REFUSAL");
    await expect.poll(() => documentToken(page)).toBe(beforeDocument);
    await expect(editor.locator('iframe[data-runtime-slot-role="active"]'))
      .toHaveAttribute("data-frame-generation", beforeGeneration);
    expect(await page.evaluate(() => (
      window.__STEMMIO_BACKGROUND_FORMAT_RUNTIME_COUNT__ || 0
    ))).toBe(beforeScriptCount);
  });
});

test("format state ignores unselected boundary text and unchanged formatting keeps the native session", async () => {
  const source = DELAYED_CHART_PAGE.replace('Revenue grew steadily this quarter.', '<span style="font-style:italic">Selected</span> unselected normal text.');
  await withRuntimeProject('stemmio-format-boundary-e2e-', { 'runtime-report.html': source }, async ({ page, sourcePath }) => {
    await loadedDiskFrame(page, sourcePath, 'format-chart');
    const editor = page.getByTestId('html-canvas-editor');
    const frame = editor.frameLocator('iframe[data-runtime-slot-role="active"]');
    const target = frame.locator('[data-native-case="format-chart"]');
    const working = await managedWorkingCopyPath(page, sourcePath);
    await doubleClickRenderedText(target);
    await target.evaluate(node => {
      const span = node.querySelector('span');
      const range = node.ownerDocument.createRange();
      range.setStart(span.firstChild, 0);
      range.setEnd(span.nextSibling, 0);
      const selection = node.ownerDocument.getSelection();
      selection.removeAllRanges(); selection.addRange(range);
      node.ownerDocument.dispatchEvent(new Event('selectionchange'));
    });
    const italic = editor.getByRole('button', { name: '斜体', exact: true });
    await expect(italic).toHaveAttribute('aria-pressed', 'true');
    await italic.click();
    await expect.poll(() => target.locator('span').first().evaluate(node => getComputedStyle(node).fontStyle)).toBe('normal');
    await editor.getByText('样式与间距', { exact: true }).click();
    const size = editor.getByLabel('字号（像素）');
    await size.fill('24');
    await expect.poll(() => readPublishedWorkingCopy(working)).toContain('font-size: 24px');
    const saved = await readPublishedWorkingCopy(working);
    // A different numeric spelling requests the same valid 24px style.
    await editor.getByText('样式与间距', { exact: true }).click();
    await size.fill('024');
    await expect(editor).toHaveAttribute('data-native-format-resume', 'unchanged:requested:resumed');
    await expect(target).toHaveAttribute('contenteditable', 'true');
    expect(await readPublishedWorkingCopy(working)).toBe(saved);
    await target.press(keyShortcut('ArrowRight'));
    await page.keyboard.insertText(' STILL_EDITING');
    await page.keyboard.press(keyShortcut('s'));
    await expect.poll(() => readPublishedWorkingCopy(working)).toContain('STILL_EDITING');
  });
});


test("in-place text Undo and Redo leave no deferred Runtime refresh", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  await withRuntimeProject("stemmio-history-no-refresh-e2e-", {
    "runtime-report.html": DELAYED_CHART_PAGE,
  }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "format-chart");
    const editor = page.getByTestId("html-canvas-editor");
    const target = frame.locator('[data-native-case="format-chart"]');
    const working = await managedWorkingCopyPath(page, sourcePath);
    const initialDocument = await documentToken(page);
    const initialScriptCount = await page.evaluate(() => (
      window.__STEMMIO_DELAYED_CHART_RUNTIME_COUNT__ || 0
    ));

    await activateNativeEdit(frame, "format-chart");
    await target.press("End");
    await page.keyboard.insertText(" HISTORY_NO_REFRESH");
    await page.keyboard.press(keyShortcut("s"));
    await expect.poll(() => readPublishedWorkingCopy(working, "utf8"))
      .toContain("HISTORY_NO_REFRESH");

    await page.keyboard.press(keyShortcut("z"));
    await expect.poll(() => readPublishedWorkingCopy(working, "utf8"))
      .not.toContain("HISTORY_NO_REFRESH");
    await expect(editor).toHaveAttribute(
      "data-history-adopt-path",
      "editable-island-in-place",
    );
    await expect(editor).not.toHaveAttribute("data-runtime-refresh-pending", "");
    await expect.poll(() => documentToken(page)).toBe(initialDocument);

    await page.keyboard.press(keyShortcut("Shift+z"));
    await expect.poll(() => readPublishedWorkingCopy(working, "utf8"))
      .toContain("HISTORY_NO_REFRESH");
    await expect(editor).toHaveAttribute(
      "data-history-adopt-path",
      "editable-island-in-place",
    );
    await expect(editor).not.toHaveAttribute("data-runtime-refresh-pending", "");
    await expect.poll(() => documentToken(page)).toBe(initialDocument);

    await page.keyboard.press("Escape");
    await frame.locator("#chart").click();
    await page.keyboard.press(keyShortcut("s"));
    await page.waitForTimeout(700);
    await expect(editor).not.toHaveAttribute("data-runtime-refresh-pending", "");
    await expect.poll(() => documentToken(page)).toBe(initialDocument);
    expect(await page.evaluate(() => (
      window.__STEMMIO_DELAYED_CHART_RUNTIME_COUNT__ || 0
    ))).toBe(initialScriptCount);
  });
});

test("editing a published Undo projection remains available while its save receipt waits", async () => {
  await withRuntimeProject('stemmio-history-followup-e2e-', { 'runtime-report.html': DELAYED_CHART_PAGE }, async ({ page, sourcePath }) => {
    await loadedDiskFrame(page, sourcePath, 'format-chart');
    const editor = page.getByTestId('html-canvas-editor');
    const frame = editor.frameLocator('iframe[data-runtime-slot-role="active"]');
    const target = frame.locator('[data-native-case="format-chart"]');
    const working = await managedWorkingCopyPath(page, sourcePath);
    await doubleClickRenderedText(target);
    await target.press(keyShortcut('ArrowRight'));
    await page.keyboard.insertText(' BEFORE_UNDO');
    await page.keyboard.press(keyShortcut('s'));
    await expect.poll(() => readPublishedWorkingCopy(working)).toContain('BEFORE_UNDO');
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    let started;
    const saving = new Promise(resolve => { started = resolve; });
    const routePattern = /\/autosave(?:\?|$)/u;
    let finishRoute;
    const routeDone = new Promise(resolve => { finishRoute = resolve; });
    let routeStarted = false;
    const routeHandler = async route => {
      routeStarted = true;
      started();
      try {
        await barrier;
        await route.continue();
      } finally {
        finishRoute();
      }
    };
    await page.route(routePattern, routeHandler);
    try {
      await page.keyboard.press(keyShortcut('z'));
      await saving;
      await expect(target).not.toContainText('BEFORE_UNDO');
      await expect(editor).toHaveAttribute('data-render-verified', 'true');
      await expect.poll(() => editor.getAttribute('data-runtime-handoff'))
        .not.toBe('positioning');
      await doubleClickRenderedText(target);
      await expect(target).toHaveAttribute('contenteditable', 'true');
      await target.press(keyShortcut('ArrowLeft'));
      for (let i = 0; i < 6; i++) await page.keyboard.press('Shift+ArrowRight');
      await editor.getByRole('button', { name: '加粗', exact: true }).click();
      await expect(editor).toHaveAttribute(
        'data-native-format-resume',
        'source:requested:resumed',
      );
      await expect(target).toHaveAttribute('contenteditable', 'true');
      await target.press(keyShortcut('ArrowRight'));
      await page.keyboard.insertText(' AFTER_UNDO');
      release();
      await page.keyboard.press(keyShortcut('s'));
      await expect.poll(() => readPublishedWorkingCopy(working)).toContain('AFTER_UNDO');
      expect(await readPublishedWorkingCopy(working)).not.toContain('BEFORE_UNDO');
    } finally {
      release();
      if (routeStarted) await routeDone;
      await page.unroute(routePattern, routeHandler);
    }
  });
});

test("a completed Save does not reclaim an external comment textbox", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const html = '<!doctype html><html><head><title>Save focus guard</title></head><body>'
    + '<p data-native-case="save-focus-guard">可编辑文字</p></body></html>';
  await withRuntimeProject("stemmio-save-focus-guard-e2e-", {
    "runtime-report.html": html,
  }, async ({ page, sourcePath }) => {
    const { editor, frame } = await loadedDiskFrame(page, sourcePath, "save-focus-guard");
    const working = await managedWorkingCopyPath(page, sourcePath);
    const target = frame.locator('[data-native-case="save-focus-guard"]');
    await doubleClickRenderedText(target);
    await expect(target).toHaveAttribute("contenteditable", /^(?:true|plaintext-only)$/u);
    await target.press("End");

    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    let started;
    const saving = new Promise(resolve => { started = resolve; });
    const routePattern = /\/autosave(?:\?|$)/u;
    let finishRoute;
    const routeDone = new Promise(resolve => { finishRoute = resolve; });
    let routeStarted = false;
    const routeHandler = async route => {
      routeStarted = true;
      started();
      try {
        await barrier;
        await route.continue();
      } finally {
        finishRoute();
      }
    };
    await page.route(routePattern, routeHandler);
    try {
      await page.keyboard.insertText(" 继续编辑");
      await page.keyboard.press(keyShortcut("s"));
      await saving;

      await editor.getByRole("button", { name: /留评论/u }).click();
      const composer = page.getByRole("region", { name: "添加评论" });
      const input = composer.getByRole("textbox", { name: "评论内容" });
      await input.click();
      await input.fill("保存等待期间的外部焦点");
      await expect.poll(() => input.evaluate(element => document.activeElement === element)).toBe(true);

      release();
      await routeDone;
      await expect.poll(() => readPublishedWorkingCopy(working, "utf8"))
        .toContain("继续编辑");
      await expect.poll(() => input.evaluate(element => document.activeElement === element)).toBe(true);
    } finally {
      release();
      if (routeStarted) await routeDone;
      await page.unroute(routePattern, routeHandler);
    }
  });
});

for (const input of ["wheel-up", "wheel-down", "keyboard-home", "scrollbar"]) {
  test(`same-document reload remembers reading intent from ${input}`, async ({}, testInfo) => {
    const html = process.env.STEMMIO_READING_HTML
      ? readFileSync(process.env.STEMMIO_READING_HTML, "utf8")
      : `<!doctype html><html><head><title>Reading position</title>
      <style>p { height: 120px; margin: 0; }</style></head><body>
      ${Array.from({ length: 40 }, (_, i) => `<p data-native-case="reading-${i}">Reading paragraph ${i}</p>`).join("")}
      </body></html>`;
    await withRuntimeProject("stemmio-reading-position-e2e-", { "runtime-report.html": html }, async ({ page, sourcePath }) => {
      if (process.env.STEMMIO_READING_HTML) {
        await waitForProjectReady(page);
        await expect(page.getByTestId("html-canvas-editor")).toHaveAttribute("data-render-verified", "true");
      } else {
        await loadedDiskFrame(page, sourcePath, "reading-0");
      }
      const stage = page.locator(".review-scroll-stage");
      await stage.evaluate((element) => { element.scrollTop = 1600; });
      await expect.poll(() => stage.evaluate((element) => element.scrollTop)).toBe(1600);
      // Observe the scroll event before issuing the next user input.
      await stage.evaluate((element) => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(element.scrollTop)))));
      const bounds = await stage.boundingBox();
      await page.mouse.move(bounds.x + 8, bounds.y + bounds.height / 2);
      if (input === "wheel-up" || input === "wheel-down") {
        await page.mouse.wheel(0, input === "wheel-up" ? -900 : 600);
      } else if (input === "keyboard-home") {
        await page.mouse.click(bounds.x + 8, bounds.y + bounds.height / 2);
        await page.keyboard.press("Home");
      } else {
        const metrics = await stage.evaluate((element) => ({
          height: element.clientHeight, scrollHeight: element.scrollHeight, top: element.scrollTop,
        }));
        const thumbHeight = metrics.height * metrics.height / metrics.scrollHeight;
        const thumbTop = metrics.top * metrics.height / metrics.scrollHeight;
        await page.mouse.move(bounds.x + bounds.width - 4, bounds.y + thumbTop + thumbHeight / 2);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width - 4, bounds.y + thumbHeight / 2 + 30, { steps: 1 });
        await page.mouse.up();
      }
      if (input === "keyboard-home") {
        await expect.poll(() => stage.evaluate((element) => element.scrollTop)).toBe(0);
      } else {
        await expect.poll(() => stage.evaluate((element) => element.scrollTop)).not.toBe(1600);
      }
      const before = await stage.evaluate((element) => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(element.scrollTop)))));
      await page.screenshot({ path: testInfo.outputPath("upward-before-reload.png") });
      const token = await documentToken(page);
      await page.getByRole("button", { name: "更多", exact: true }).click();
      await page.getByRole("menuitem", { name: "从磁盘重新载入 HTML", exact: true }).click();
      await expect.poll(() => documentToken(page)).not.toBe(token);
      await expect(page.getByTestId("html-canvas-editor")).toHaveAttribute("data-render-verified", "true");
      await expect.poll(() => stage.evaluate((element) => element.scrollTop)).toBeCloseTo(before, 0);
      await page.screenshot({ path: testInfo.outputPath("upward-after-reload.png") });
    });
  });
}

test("comment reveal and layout alignment preserve the latest reading intent", async ({}, testInfo) => {
  const html = `<!doctype html><html><head><title>Reading comments</title>
    <style>p { height: 120px; margin: 0; }</style></head><body>
    ${Array.from({ length: 40 }, (_, i) => `<p data-native-case="reading-${i}">Reading paragraph ${i}</p>`).join("")}
    </body></html>`;
  await withRuntimeProject("stemmio-reading-comments-e2e-", { "runtime-report.html": html }, async ({ page, sourcePath }) => {
    const { frame } = await loadedDiskFrame(page, sourcePath, "reading-0");
    const stage = page.locator(".review-scroll-stage");
    await stage.evaluate(element => { element.scrollTop = 1500; });
    await frame.locator('[data-native-case="reading-14"]').click();
    await page.getByRole("toolbar", { name: /编辑/u }).getByRole("button", { name: /留评论/u }).click();
    await page.getByRole("textbox", { name: "评论内容" }).fill("Reading anchor comment");
    await page.getByRole("button", { name: "评论", exact: true }).click();
    await expect(page.locator(".comment-card").filter({ hasText: "Reading anchor comment" })).toBeVisible();
    await expect.poll(() => stage.evaluate(element => element.scrollTop)).toBe(1600);
    const bounds = await stage.boundingBox();
    await page.mouse.move(bounds.x + 8, bounds.y + bounds.height / 2);
    await page.mouse.wheel(0, -900);
    await expect.poll(() => stage.evaluate(element => element.scrollTop)).toBeLessThan(1000);
    await stage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const before = await stage.evaluate(element => element.scrollTop);
    // Resizing the shell recomputes comment geometry; this is not a request to reveal a comment.
    await page.setViewportSize({ width: 1100, height: 760 });
    await stage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await stage.evaluate(element => element.scrollTop)).toBeCloseTo(before, 0);
    const token = await documentToken(page);
    await page.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: "从磁盘重新载入 HTML", exact: true }).click();
    await expect.poll(() => documentToken(page)).not.toBe(token);
    await expect(page.getByTestId("html-canvas-editor")).toHaveAttribute("data-render-verified", "true");
    await expect.poll(() => stage.evaluate(element => element.scrollTop)).toBeCloseTo(before, 0);
    await page.screenshot({ path: testInfo.outputPath("reading-after-comment-and-resize.png") });
  });
});

for (const input of ["outer-wheel", "iframe-wheel", "keyboard-home", "scrollbar"]) {
  test(`reading intent cancels a comment reveal waiting for its frame: ${input}`, async () => {
    const html = `<!doctype html><html><head><title>Delayed comment</title>
      <style>p { height: 120px; margin: 0; }</style></head><body>
      ${Array.from({ length: 40 }, (_, i) => `<p data-native-case="reading-${i}">Reading paragraph ${i}</p>`).join("")}
      </body></html>`;
    await withRuntimeProject("stemmio-reading-pending-e2e-", { "runtime-report.html": html }, async ({ page, sourcePath }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      const { frame } = await loadedDiskFrame(page, sourcePath, "reading-0");
      const stage = page.locator(".review-scroll-stage");
      await stage.evaluate(element => { element.scrollTop = 1500; });
      await frame.locator('[data-native-case="reading-14"]').click();
      await page.getByRole("toolbar", { name: /编辑/u }).getByRole("button", { name: /留评论/u }).click();
      await page.getByRole("textbox", { name: "评论内容" }).fill("Delayed reading comment");
      await expect.poll(() => stage.evaluate(element => element.scrollTop)).toBeGreaterThan(1400);
      await stage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.evaluate(() => {
        const request = window.requestAnimationFrame.bind(window);
        const cancel = window.cancelAnimationFrame.bind(window);
        let sequence = 0;
        const pending = new Map();
        window.requestAnimationFrame = callback => {
          const id = --sequence;
          pending.set(id, callback);
          return id;
        };
        window.cancelAnimationFrame = id => {
          if (id < 0) pending.delete(id);
          else cancel(id);
        };
        window.__releaseReadingFrames = () => {
          window.requestAnimationFrame = request;
          window.cancelAnimationFrame = cancel;
          for (const callback of pending.values()) request(callback);
          pending.clear();
        };
      });
      try {
        await page.getByRole("button", { name: "评论", exact: true }).dispatchEvent("click");
        await expect(page.getByRole("textbox", { name: "评论内容" })).toBeHidden();
        const bounds = await stage.boundingBox();
        if (input === "outer-wheel" || input === "iframe-wheel") {
          await page.mouse.move(bounds.x + (input === "outer-wheel" ? 8 : 300), bounds.y + bounds.height / 2);
          await page.mouse.wheel(0, -900);
        } else if (input === "keyboard-home") {
          await page.mouse.click(bounds.x + 8, bounds.y + bounds.height / 2);
          await page.keyboard.press("Home");
        } else {
          const metrics = await stage.evaluate(element => ({ height: element.clientHeight, scrollHeight: element.scrollHeight, top: element.scrollTop }));
          const thumbHeight = metrics.height * metrics.height / metrics.scrollHeight;
          const thumbTop = metrics.top * metrics.height / metrics.scrollHeight;
          await page.mouse.move(bounds.x + bounds.width - 4, bounds.y + thumbTop + thumbHeight / 2);
          await page.mouse.down();
          await page.mouse.move(bounds.x + bounds.width - 4, bounds.y + thumbHeight / 2 + 30);
          await page.mouse.up();
        }
        if (input === "keyboard-home") await expect.poll(() => stage.evaluate(element => element.scrollTop)).toBe(0);
        else await expect.poll(() => stage.evaluate(element => element.scrollTop)).toBeLessThan(1000);
        const before = await stage.evaluate(element => element.scrollTop);
        await page.evaluate(() => window.__releaseReadingFrames());
        await expect(page.getByRole("textbox", { name: "评论内容" })).toBeHidden();
        const card = page.locator(".comment-card").filter({ hasText: "Delayed reading comment" });
        await expect(card).toHaveCount(1);
        await stage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
        expect(await stage.evaluate(element => element.scrollTop)).toBeCloseTo(before, 0);
        const token = await documentToken(page);
        await page.getByRole("button", { name: "更多", exact: true }).click();
        await page.getByRole("menuitem", { name: "从磁盘重新载入 HTML", exact: true }).click();
        await expect.poll(() => documentToken(page)).not.toBe(token);
        await expect(page.getByTestId("html-canvas-editor")).toHaveAttribute("data-render-verified", "true");
        await expect.poll(() => stage.evaluate(element => element.scrollTop)).toBeCloseTo(before, 0);
        await card.click();
        await expect.poll(() => stage.evaluate(element => element.scrollTop)).toBe(1600);
      } finally {
        await page.evaluate(() => window.__releaseReadingFrames());

      }
    });
  });
}

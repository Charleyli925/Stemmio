import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { executeFrozenSelection, frozenFrameAccess, selectionExecutionIssues }
  from "../electron/real-html/frozen-selection.mjs";
import { readFrozenActiveGeneration, requireCurrentTextDocument, requireFrozenTextFocus }
  from "../electron/real-html/frozen-text.mjs";
import { probeFrozenEndedContinuation } from "../electron/real-html/frozen-structure.mjs";
import { revealFrozenCommentDelete } from "../electron/real-html/frozen-mixed.mjs";

test("frozen generation reads the active iframe and rejects absent or ambiguous identities", async ({ page }) => {
  await page.setContent('<main data-runtime-root data-canvas-generation="999"><iframe data-runtime-slot-role="active" data-frame-generation="2"></iframe></main>');
  const root = page.locator("[data-runtime-root]");
  expect(await readFrozenActiveGeneration(root)).toBe("2");
  await root.locator("iframe").evaluate((frame) => frame.removeAttribute("data-frame-generation"));
  await expect(readFrozenActiveGeneration(root)).rejects.toMatchObject({ code: "FROZEN_ACTIVE_GENERATION_MISSING" });
  await root.evaluate((element) => element.append(element.querySelector("iframe").cloneNode()));
  await expect(readFrozenActiveGeneration(root)).rejects.toMatchObject({ code: "FROZEN_ACTIVE_FRAME_NOT_UNIQUE" });
});

import {
  authoredTabActivationDecision,
  canonicalSourceRelationship,
  collectVisibleAuthoredCandidates,
  discoverRuntimeGeneratedTargets,
  driveAuthoredTabActivation,
  normalizeCapabilityProbeObservations,
  probeAuthoredCapability,
  resetAuthoredProbeSelection,
  runtimeGeneratedDiagnosticsIssue,
} from "../electron/real-html/capability-driver.mjs";

const CORRECT_ID = "sm1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const WRONG_ID = "sm1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PARENT_ID = "sm1_cccccccccccccccccccccccccccccccc";

const HARNESS_TEST_OPTIONS = { tag: ["@gate-smoke", "@smoke-editing"] };

for (const reveal of [true, false]) test(`frozen comment hover proves reveal=${reveal}`, HARNESS_TEST_OPTIONS, async ({ page }) => {
  const css = ["review-v5.css", "comment-hierarchy.css"].map(name =>
    readFileSync(new URL(`../../../app/styles/${name}`, import.meta.url), "utf8")).join("\n");
  await page.setContent(`<style>${css}</style><article class="comment-card" style="position:relative;width:400px;height:120px">
    <p>Fixed comment</p><footer class="comment-card-footer"><button aria-label="删除评论">Delete</button></footer></article>`);
  const card = page.locator(".comment-card"), button = card.getByRole("button", { name: "删除评论" });
  expect(await button.evaluate(element => getComputedStyle(element).pointerEvents)).toBe("none");
  if (!reveal) await page.addStyleTag({ content: ".comment-card:hover .comment-card-footer{pointer-events:none!important}" });
  if (reveal) {
    await page.evaluate(() => document.querySelector("button").addEventListener("click", () => document.body.dataset.clicked = "true"));
    await (await revealFrozenCommentDelete(card)).click({ timeout: 2_000 });
    await expect(page.locator("body")).toHaveAttribute("data-clicked", "true");
  } else await expect(revealFrozenCommentDelete(card)).rejects.toThrow();
});

for (const mode of ["ended", "wrong-focus", "wrong-input", "observer-missing", "observer-invalid"]) {
  test(`frozen direct continuation proves ${mode}`, HARNESS_TEST_OPTIONS, async ({ page }) => {
    await page.setContent('<main data-editor data-e2e-copy-native-edit-ended="true"><iframe data-runtime-slot-role="active" data-frame-generation="2"></iframe></main><input id="wrong">');
    const editor = page.locator("[data-editor]");
    const frame = await (await editor.locator("iframe").elementHandle()).contentFrame();
    await frame.setContent(`<p data-stemmio-id="${CORRECT_ID}">Fixed target</p>`);
    if (mode === "wrong-focus") await page.locator("#wrong").focus();
    if (mode === "wrong-input") await page.evaluate(() => document.addEventListener("keydown", () => {
      document.getElementById("wrong").focus();
    }, { once: true }));
    if (mode === "observer-missing") await page.evaluate(() => document.addEventListener("keydown", () => {
      delete globalThis.__STEMMIO_FROZEN_INPUT_DELIVERY__;
    }, { once: true }));
    if (mode === "observer-invalid") await page.evaluate(() => document.addEventListener("keydown", () => {
      globalThis.__STEMMIO_FROZEN_INPUT_DELIVERY__.stop = () => "";
    }, { once: true }));
    const result = probeFrozenEndedContinuation({ page, frame, editor,
      target: { clickId: CORRECT_ID, selectedId: CORRECT_ID }, readSource: async () => Buffer.from("unchanged"),
      calls: [], marker: "PROBE" });
    if (mode === "ended") expect((await result).mode).toBe("session-ended-no-refocus");
    else await expect(result).rejects.toThrow(mode === "wrong-focus" ? "FROZEN_CONTINUATION_UNSAFE_FOCUS"
      : mode === "wrong-input" ? "FROZEN_DIRECT_CONTINUATION_MISMATCH"
        : mode === "observer-missing" ? "FROZEN_INPUT_OBSERVER_MISSING" : "FROZEN_INPUT_OBSERVER_INVALID");
  });
}

test("authored tab activation waits for a delayed action and fails ambiguous state", HARNESS_TEST_OPTIONS, async () => {
  expect(authoredTabActivationDecision({
    tabCount: 1,
    active: false,
    activationButtonCount: 0,
    activationButtonVisible: false,
    activationButtonEnabled: false,
  })).toEqual({ state: "pending", reason: "TAB_ACTIVATION_PENDING" });
  expect(authoredTabActivationDecision({
    tabCount: 1,
    active: false,
    activationButtonCount: 1,
    activationButtonVisible: true,
    activationButtonEnabled: true,
  })).toEqual({ state: "activate", reason: "TAB_ACTIVATION_ACTION_READY" });
  expect(authoredTabActivationDecision({
    tabCount: 1,
    active: true,
    activationButtonCount: 0,
    activationButtonVisible: false,
    activationButtonEnabled: false,
  })).toEqual({ state: "active", reason: "TAB_ALREADY_ACTIVE" });
  expect(authoredTabActivationDecision({
    tabCount: 2,
    active: false,
    activationButtonCount: 0,
    activationButtonVisible: false,
    activationButtonEnabled: false,
  })).toEqual({ state: "failed", reason: "TAB_STABLE_ID_NOT_UNIQUE" });
});

test("authored tab driver reaches active after a delayed action and fails a disappearing action", HARNESS_TEST_OPTIONS, async () => {
  let activePrepareCount = 0;
  let activeSelectCount = 0;
  const alreadyActive = await driveAuthoredTabActivation({
    readState: async () => ({
      tabCount: 1,
      active: true,
      activationButtonCount: 0,
      activationButtonVisible: false,
      activationButtonEnabled: false,
    }),
    prepareSelection: async () => { activePrepareCount += 1; },
    selectTab: async () => { activeSelectCount += 1; },
    activateTab: async () => {},
  });
  expect(alreadyActive.decision.state).toBe("active");
  expect(activePrepareCount).toBe(1);
  expect(activeSelectCount).toBe(0);

  const pendingSnapshot = async () => ({
    tabCount: 1,
    active: false,
    activationButtonCount: 0,
    activationButtonVisible: false,
    activationButtonEnabled: false,
  });
  await expect(driveAuthoredTabActivation({
    readState: pendingSnapshot,
    prepareSelection: async () => {
      const error = new Error("sticky selection");
      error.code = "SELECTION_RESET_FAILED";
      throw error;
    },
    selectTab: async () => {},
    activateTab: async () => {},
    timeoutMs: 50,
  })).rejects.toMatchObject({
    code: "TAB_ACTIVATION_NOT_SETTLED",
    details: {
      phase: "prepare-selection",
      causeCode: "SELECTION_RESET_FAILED",
      cause: "sticky selection",
    },
  });
  await expect(driveAuthoredTabActivation({
    readState: pendingSnapshot,
    prepareSelection: async () => {},
    selectTab: async () => {
      const error = new Error("tab intercepted");
      error.code = "POINTER_INTERCEPTED";
      throw error;
    },
    activateTab: async () => {},
    timeoutMs: 50,
  })).rejects.toMatchObject({
    code: "TAB_ACTIVATION_NOT_SETTLED",
    details: {
      phase: "select-tab",
      causeCode: "POINTER_INTERCEPTED",
      cause: "tab intercepted",
    },
  });

  let state = "pending";
  let activationClicks = 0;
  const delayedAction = setTimeout(() => { state = "activate"; }, 20);
  const completed = await driveAuthoredTabActivation({
    readState: async () => ({
      tabCount: 1,
      active: state === "active",
      activationButtonCount: state === "activate" ? 1 : 0,
      activationButtonVisible: state === "activate",
      activationButtonEnabled: state === "activate",
    }),
    prepareSelection: async () => {},
    selectTab: async () => {},
    activateTab: async () => {
      activationClicks += 1;
      state = "active";
    },
    timeoutMs: 500,
    pollIntervalMs: 5,
  });
  clearTimeout(delayedAction);
  expect(completed.decision.state).toBe("active");
  expect(activationClicks).toBe(1);

  state = "activate";
  await expect(driveAuthoredTabActivation({
    readState: async () => ({
      tabCount: 1,
      active: false,
      activationButtonCount: state === "activate" ? 1 : 0,
      activationButtonVisible: state === "activate",
      activationButtonEnabled: state === "activate",
    }),
    prepareSelection: async () => {},
    selectTab: async () => {},
    activateTab: async () => {
      state = "pending";
      throw new Error("activation button detached");
    },
    timeoutMs: 80,
    pollIntervalMs: 5,
  })).rejects.toMatchObject({
    code: "TAB_ACTIVATION_NOT_SETTLED",
    details: { decision: { state: "pending" } },
  });
});

async function installRuntimeDiagnosticReset(page) {
  await page.evaluate(() => {
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      const root = document.querySelector("[data-runtime-root]");
      for (const name of [
        "data-selection-runtime-generated",
        "data-selection-runtime-generation",
        "data-selection-runtime-source-anchor-id",
        "data-selection-runtime-kind",
        "data-selection-runtime-path",
      ]) root?.removeAttribute(name);
    });
  });
}

async function capabilityFixture(
  page,
  selectedId = null,
  targetTag = "p",
  { resetOnEscape = true } = {},
) {
  await page.setContent(`
    <style>
      #target { display:block; width:240px; height:80px; }
      [role="toolbar"] { position:fixed; inset:0 auto auto 0; width:260px; height:96px; z-index:10; }
    </style>
    <main data-runtime-root data-element-copy-availability="available" data-element-copy-reason="available">
      <${targetTag} id="target" data-stemmio-id="${CORRECT_ID}">editable authored text</${targetTag}>
      <p data-stemmio-id="${WRONG_ID}">other text</p>
      <div role="toolbar" aria-label="元素工具栏" hidden>
        <button aria-label="留评论"></button>
        <button aria-label="编辑"></button>
        <button aria-label="复制元素"></button>
        <button aria-label="上移"></button>
        <button aria-label="删除元素"></button>
      </div>
    </main>
  `);
  await page.locator("#target").evaluate((element, payload) => {
    window.__capabilityProbeClickCount = 0;
    document.querySelectorAll("[data-stemmio-id]").forEach((target) => {
      target.addEventListener("click", (event) => {
        window.__capabilityProbeClickCount += 1;
        window.__capabilityProbeAltKey = event.altKey;
        document.querySelectorAll("[data-html-canvas-selected]")
          .forEach((candidate) => candidate.removeAttribute("data-html-canvas-selected"));
        const nextId = payload.selectedId || target.getAttribute("data-stemmio-id");
        document.querySelector(`[data-stemmio-id="${nextId}"]`)
          ?.setAttribute("data-html-canvas-selected", "");
        document.querySelector('[role="toolbar"]')?.removeAttribute("hidden");
      });
    });
    if (payload.resetOnEscape) {
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape") return;
        document.querySelectorAll("[data-html-canvas-selected]")
          .forEach((candidate) => candidate.removeAttribute("data-html-canvas-selected"));
        document.querySelector('[role="toolbar"]')?.setAttribute("hidden", "");
      });
    }
  }, { selectedId, resetOnEscape });
}

function candidate(stableId = CORRECT_ID) {
  return {
    stableId,
    tag: "p",
    sourceEditable: true,
    visible: true,
    isConnected: true,
    inert: false,
    runtimeGenerated: false,
    tabId: null,
    region: "top",
    scrollContainer: "document",
  };
}

async function canonicalCapabilityFixture(page, selectedId = PARENT_ID, toolbarLabel = "元素工具栏") {
  await page.setContent(`
    <main data-runtime-root data-element-copy-availability="available" data-element-copy-reason="available">
      <h1 data-stemmio-id="${PARENT_ID}" style="display:block;width:260px;height:90px">
        <span id="target" data-stemmio-id="${CORRECT_ID}" style="display:block;width:220px;height:70px">
          canonical child
        </span>
      </h1>
      <p data-stemmio-id="${WRONG_ID}">unrelated sibling</p>
      <div role="toolbar" aria-label="${toolbarLabel}" hidden>
        <button aria-label="留评论"></button>
        <button aria-label="编辑"></button>
        <button aria-label="复制元素"></button>
      </div>
    </main>
  `);
  await page.locator("#target").evaluate((target, operationId) => {
    target.addEventListener("click", () => {
      document.querySelector(`[data-stemmio-id="${operationId}"]`)
        ?.setAttribute("data-html-canvas-selected", "subregion");
      document.querySelector('[role="toolbar"]')?.removeAttribute("hidden");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      document.querySelectorAll("[data-html-canvas-selected]")
        .forEach((element) => element.removeAttribute("data-html-canvas-selected"));
      document.querySelector('[role="toolbar"]')?.setAttribute("hidden", "");
    });
  }, selectedId);
}

function canonicalSourceElements({ childParentId = PARENT_ID, duplicateParent = false } = {}) {
  const rows = [
    {
      stemmioId: PARENT_ID,
      stemmioIdentityStatus: "valid",
      parentId: null,
      tagName: "h1",
      sourceOrder: 0,
      sourceEditable: true,
    },
    {
      stemmioId: CORRECT_ID,
      stemmioIdentityStatus: "valid",
      parentId: childParentId,
      tagName: "span",
      sourceOrder: 1,
      sourceEditable: false,
    },
    {
      stemmioId: WRONG_ID,
      stemmioIdentityStatus: "valid",
      parentId: null,
      tagName: "p",
      sourceOrder: 2,
      sourceEditable: true,
    },
  ];
  if (duplicateParent) rows.push({ ...rows[0], sourceOrder: 3 });
  return rows;
}

for (const mode of ["padding", "canvas-through-parent", "wrong-hit", "wrong-landing", "outside-point"]) {
  test(`frozen fixed point preserves identity: ${mode}`, HARNESS_TEST_OPTIONS, async ({ page }) => {
    const canvas = mode !== "padding";
    await page.setContent(`<div data-stemmio-id="${PARENT_ID}" style="padding:10px"><${canvas ? "canvas" : "div"}
      data-stemmio-id="${CORRECT_ID}" style="width:200px;height:80px;display:block;${canvas ? "pointer-events:none" : ""}"></${canvas ? "canvas" : "div"}></div>
      <p data-stemmio-id="${WRONG_ID}">Other</p>`);
    await page.evaluate(({ correct, wrong, mode }) => document.addEventListener("click", () => {
      document.querySelector(`[data-stemmio-id="${mode === "wrong-landing" ? wrong : correct}"]`).setAttribute("data-html-canvas-selected", "part");
    }), { correct: CORRECT_ID, wrong: WRONG_ID, mode });
    const target = { clickId: CORRECT_ID, selectedId: CORRECT_ID, clickTag: canvas ? "canvas" : "div", selectedTag: canvas ? "canvas" : "div",
      selectionPoint: { x: mode === "outside-point" ? 300 : 10, y: 10,
        expectedHitId: mode === "wrong-hit" ? WRONG_ID : canvas ? PARENT_ID : CORRECT_ID,
        basis: canvas ? "dedicated-canvas-through-parent" : "direct-authored-hit" } };
    const calls = [], execution = executeFrozenSelection({ access: frozenFrameAccess(page, target, calls),
      keyboard: page.keyboard, mouse: page.mouse, target, calls });
    if (mode === "padding" || mode === "canvas-through-parent") {
      expect((await execution).state).toBe("PASS"); expect(selectionExecutionIssues(calls, target)).toEqual([]);
      expect(calls.filter(c => c.kind === "pointer-click")).toHaveLength(1);
    } else {
      await expect(execution).rejects.toMatchObject({ code: mode === "wrong-landing" ? "FROZEN_SELECTION_FAILED" : "FROZEN_POINTER_HIT_MISMATCH" });
      expect(calls.filter(c => c.kind === "pointer-click")).toHaveLength(mode === "wrong-landing" ? 1 : 0);
    }
  });
}

test("frozen executor selects one exact target and supports only the pre-reviewed mapping", HARNESS_TEST_OPTIONS, async ({ page }) => {
  for (const selectedId of [CORRECT_ID, PARENT_ID]) {
    await canonicalCapabilityFixture(page, selectedId);
    const target = { clickId: CORRECT_ID, selectedId, clickTag: "span",
      selectedTag: selectedId === CORRECT_ID ? "span" : "h1" };
    const calls = [];
    const selectors = [];
    const result = await executeFrozenSelection({
      access: frozenFrameAccess({ locator(selector) {
        selectors.push(selector);
        return page.locator(selector);
      } }, target, calls), keyboard: page.keyboard, target, calls,
    });
    expect(result.state).toBe("PASS");
    expect(new Set(selectors)).toEqual(new Set([
      `[data-stemmio-id="${CORRECT_ID}"]`, `[data-stemmio-id="${selectedId}"]`,
      "[data-html-canvas-selected]",
    ]));
    expect(calls.filter((call) => call.kind === "pointer-click")).toHaveLength(1);
    expect(selectionExecutionIssues(calls, target)).toEqual([]);
    for (const kind of ["scan", "replace-target", "infer-mapping"]) {
      expect(selectionExecutionIssues([...calls, { kind }], target))
        .toContain("FORBIDDEN_EXECUTION_ACTIVITY");
    }
  }
});

test("frozen executor rejects mapping drift, duplicate or absent identity without replacement", HARNESS_TEST_OPTIONS, async ({ page }) => {
  const target = { clickId: CORRECT_ID, selectedId: PARENT_ID, clickTag: "span", selectedTag: "h1" };
  await canonicalCapabilityFixture(page, CORRECT_ID);
  let calls = [];
  await expect(executeFrozenSelection({ access: frozenFrameAccess(page, target, calls),
    keyboard: page.keyboard, target, calls })).rejects.toMatchObject({ code: "FROZEN_SELECTION_FAILED" });
  expect(calls.filter((call) => call.kind === "pointer-click")).toHaveLength(1);
  for (const mode of ["duplicate", "absent"]) {
    await canonicalCapabilityFixture(page);
    await page.locator("#target").evaluate((element, mutation) => {
      if (mutation === "duplicate") element.after(element.cloneNode(true));
      else element.remove();
    }, mode);
    calls = [];
    await expect(executeFrozenSelection({ access: frozenFrameAccess(page, target, calls),
      keyboard: page.keyboard, target, calls })).rejects.toMatchObject({ code: "FROZEN_IDENTITY_COUNT_MISMATCH" });
    expect(calls.filter((call) => call.kind === "pointer-click")).toHaveLength(0);
  }
  expect(() => frozenFrameAccess(page, target, []).target(WRONG_ID))
    .toThrow(expect.objectContaining({ code: "UNPLANNED_TARGET_LOOKUP" }));
});

test("frozen target switch verifies its known prior identity instead of relying on Escape reset", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`<button id="toolbar">Copy</button><span data-stemmio-id="${WRONG_ID}" data-html-canvas-selected="part">Original</span>
    <span data-stemmio-id="${CORRECT_ID}">Copy</span>`);
  await page.evaluate(() => document.addEventListener("click", event => {
    if (!event.target.matches("span")) return;
    document.querySelector("[data-html-canvas-selected]")?.removeAttribute("data-html-canvas-selected");
    event.target.setAttribute("data-html-canvas-selected", "part");
  }));
  await page.locator("#toolbar").click();
  const target = { clickId: CORRECT_ID, selectedId: CORRECT_ID, clickTag: "span", selectedTag: "span" };
  for (const priorSelectionId of [null, PARENT_ID]) {
    const calls = [];
    await expect(executeFrozenSelection({ access: frozenFrameAccess(page, target, calls),
      keyboard: page.keyboard, target, calls, priorSelectionId })).rejects.toMatchObject({ code: "FROZEN_SELECTION_INITIAL_STATE_MISMATCH" });
    expect(calls.some(call => call.kind === "pointer-click")).toBe(false);
  }
  const calls = [];
  const result = await executeFrozenSelection({ access: frozenFrameAccess(page, target, calls),
    keyboard: page.keyboard, target, calls, priorSelectionId: WRONG_ID });
  expect(result).toMatchObject({ state: "PASS", initialSelectionId: WRONG_ID, actual: CORRECT_ID });
  expect(selectionExecutionIssues(calls, target)).toEqual([]);
});

test("frozen text accepts the current document and native caret but rejects stale document and wrong landing", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`<p contenteditable="true" data-stemmio-id="${CORRECT_ID}">Synthetic</p>
    <p contenteditable="true" data-stemmio-id="${WRONG_ID}">Other</p>`);
  const locator = page.locator(`[data-stemmio-id="${CORRECT_ID}"]`);
  const handle = await locator.elementHandle();
  const documentHandle = await page.evaluateHandle(() => document);
  const oldDocument = await page.evaluateHandle(() => document.implementation.createHTMLDocument("old"));
  await expect(requireCurrentTextDocument(page, documentHandle, handle)).resolves.toEqual({
    currentDocument: true, targetInCurrentDocument: true, connected: true,
  });
  await expect(requireCurrentTextDocument(page, oldDocument, handle))
    .rejects.toMatchObject({ code: "FROZEN_TEXT_DOCUMENT_REPLACED" });
  await locator.click();
  await locator.press("End");
  await expect(requireFrozenTextFocus(handle, CORRECT_ID, { atEnd: true }))
    .resolves.toMatchObject({ conditions: { identityMatches: true, focusMatches: true, caretAtEnd: true } });
  await handle.evaluate((element) => element.blur());
  await expect(requireFrozenTextFocus(handle, CORRECT_ID))
    .rejects.toMatchObject({ code: "FROZEN_TEXT_FOCUS_MISMATCH" });
  await locator.click();
  await locator.press("End");
  await locator.press("ArrowLeft");
  await expect(requireFrozenTextFocus(handle, CORRECT_ID, { atEnd: true }))
    .rejects.toMatchObject({ code: "FROZEN_TEXT_FOCUS_MISMATCH" });
  await page.locator(`[data-stemmio-id="${WRONG_ID}"]`).click();
  await expect(requireFrozenTextFocus(handle, CORRECT_ID))
    .rejects.toMatchObject({ code: "FROZEN_TEXT_FOCUS_MISMATCH" });
  await handle.evaluate((element) => element.remove());
  await expect(requireCurrentTextDocument(page, documentHandle, handle))
    .rejects.toMatchObject({ code: "FROZEN_TEXT_DOCUMENT_REPLACED" });
  await Promise.all([handle.dispose(), documentHandle.dispose(), oldDocument.dispose()]);
});

test("capability preflight waits for delayed toolbar commit but never turns a missing toolbar into denied capability", HARNESS_TEST_OPTIONS, async ({ page }) => {
  for (const delay of [150, null]) {
    await canonicalCapabilityFixture(page);
    await page.locator("#target").evaluate((target, delayMs) => {
      target.addEventListener("click", () => {
        const toolbar = document.querySelector('[role="toolbar"]');
        toolbar.setAttribute("hidden", "");
        if (delayMs !== null) setTimeout(() => toolbar.removeAttribute("hidden"), delayMs);
      });
    }, delay);
    const probe = probeAuthoredCapability({ page, frame: page,
      editor: page.locator("[data-runtime-root]"),
      candidate: { ...candidate(), tag: "span" }, mode: "discover",
      sourceElements: canonicalSourceElements() });
    if (delay === null) await expect(probe).rejects.toMatchObject({
      code: "CAPABILITY_PROBE_TOOLBAR_NOT_SETTLED", details: { visibleToolbarCount: 0 },
    });
    else await expect(probe).resolves.toMatchObject({
      operationStableId: PARENT_ID, probeReason: "CAPABILITY_OBSERVED",
      capabilityFamilies: expect.arrayContaining(["text", "format", "copy"]),
    });
  }
});

test("capability discovery freezes a child hit to its proven authored operation ancestor", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await canonicalCapabilityFixture(page);
  const sourceElements = canonicalSourceElements();
  const discovered = await probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: { ...candidate(), sourceEditable: false, sourceOrder: 1 },
    mode: "discover",
    sourceElements,
  });
  expect(discovered).toMatchObject({
    probeStableId: CORRECT_ID,
    operationStableId: PARENT_ID,
    stableId: PARENT_ID,
    selectedId: PARENT_ID,
    tag: "h1",
    sourceEditable: true,
  });
  expect(discovered.capabilityFamilies).toEqual(expect.arrayContaining(["text", "format"]));

  const verified = await probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: {
      ...candidate(),
      stableId: CORRECT_ID,
      expectedOperationStableId: PARENT_ID,
      sourceEditable: true,
      sourceOrder: 1,
    },
    mode: "verify",
    sourceElements,
  });
  expect(verified.selectedId).toBe(PARENT_ID);
});

test("capability discovery rejects DOM-only ancestry, duplicate source identity, and Runtime targets", HARNESS_TEST_OPTIONS, async ({ page }) => {
  const input = (sourceElements) => ({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: { ...candidate(), sourceEditable: false, sourceOrder: 1 },
    mode: "discover",
    sourceElements,
  });
  await canonicalCapabilityFixture(page);
  await expect(probeAuthoredCapability(input(canonicalSourceElements({ childParentId: null }))))
    .rejects.toMatchObject({ code: "CAPABILITY_PROBE_CANONICAL_MAPPING_INVALID" });

  await canonicalCapabilityFixture(page);
  await expect(probeAuthoredCapability(input(canonicalSourceElements({ duplicateParent: true }))))
    .rejects.toMatchObject({ code: "CAPABILITY_PROBE_CANONICAL_MAPPING_INVALID" });

  await canonicalCapabilityFixture(page, PARENT_ID, "评论工具栏");
  await expect(probeAuthoredCapability(input(canonicalSourceElements())))
    .rejects.toMatchObject({ code: "CAPABILITY_PROBE_RUNTIME_GENERATED_OPERATION_TARGET" });
});

test("capability discovery rejects source-only ancestry and verification mapping drift", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <main data-runtime-root data-element-copy-availability="available" data-element-copy-reason="available">
      <h1 data-stemmio-id="${PARENT_ID}">detached operation target</h1>
      <span id="target" data-stemmio-id="${CORRECT_ID}">probe child in source only</span>
      <div role="toolbar" aria-label="元素工具栏" hidden><button aria-label="编辑"></button></div>
    </main>
  `);
  await page.locator("#target").evaluate((target, operationId) => {
    target.addEventListener("click", () => {
      document.querySelector(`[data-stemmio-id="${operationId}"]`)
        ?.setAttribute("data-html-canvas-selected", "subregion");
      document.querySelector('[role="toolbar"]')?.removeAttribute("hidden");
    });
  }, PARENT_ID);
  await expect(probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: { ...candidate(), sourceEditable: false, sourceOrder: 1 },
    mode: "discover",
    sourceElements: canonicalSourceElements(),
  })).rejects.toMatchObject({ code: "CAPABILITY_PROBE_CANONICAL_MAPPING_INVALID" });

  await canonicalCapabilityFixture(page, CORRECT_ID);
  await expect(probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: {
      ...candidate(),
      expectedOperationStableId: PARENT_ID,
      sourceEditable: true,
      sourceOrder: 1,
    },
    mode: "verify",
    sourceElements: canonicalSourceElements(),
  })).rejects.toMatchObject({ code: "CAPABILITY_PROBE_SELECTION_IDENTITY_MISMATCH" });
});

test("canonical source and alias normalization fail closed and keep one deterministic operation row", HARNESS_TEST_OPTIONS, async () => {
  expect(canonicalSourceRelationship(canonicalSourceElements(), CORRECT_ID, PARENT_ID))
    .toMatchObject({ validProbe: true, validOperation: true, sourceAncestor: true });
  expect(canonicalSourceRelationship(canonicalSourceElements({ childParentId: null }), CORRECT_ID, PARENT_ID))
    .toMatchObject({ sourceAncestor: false });

  const snapshot = {
    stableId: PARENT_ID,
    operationStableId: PARENT_ID,
    capabilityFamilies: ["selection", "text"],
    behaviorFamilies: ["activation", "input"],
    copyAvailability: "unsupported",
    copyReason: "unsupported",
    runtimeGenerated: false,
    tag: "h1",
    sourceEditable: true,
    region: "top",
    scrollContainer: "document",
  };
  const normalized = normalizeCapabilityProbeObservations([
    { ...snapshot, probeStableId: WRONG_ID, probeSourceOrder: 2 },
    { ...snapshot, probeStableId: CORRECT_ID, probeSourceOrder: 1 },
  ]);
  expect(normalized.liveDom).toHaveLength(1);
  expect(normalized.liveDom[0].probeStableId).toBe(CORRECT_ID);
  expect(normalized.aliases).toHaveLength(2);
  const direct = normalizeCapabilityProbeObservations([
    { ...snapshot, probeStableId: CORRECT_ID, probeSourceOrder: 1 },
    { ...snapshot, probeStableId: PARENT_ID, probeSourceOrder: 0 },
  ]);
  expect(direct.liveDom[0].probeStableId).toBe(PARENT_ID);
  expect(direct.aliases).toEqual([{ probeStableId: CORRECT_ID, operationStableId: PARENT_ID }]);
  expect(() => normalizeCapabilityProbeObservations([
    { ...snapshot, probeStableId: CORRECT_ID, probeSourceOrder: 1 },
    { ...snapshot, probeStableId: WRONG_ID, probeSourceOrder: 2, capabilityFamilies: ["selection"] },
  ])).toThrow(expect.objectContaining({ code: "CAPABILITY_PROBE_ALIAS_CAPABILITY_CONFLICT" }));
  expect(() => normalizeCapabilityProbeObservations([
    { ...snapshot, probeStableId: CORRECT_ID, probeSourceOrder: 1 },
    {
      ...snapshot,
      probeStableId: WRONG_ID,
      probeSourceOrder: 2,
      capabilityFamilies: [],
      behaviorFamilies: [],
    },
  ])).toThrow(expect.objectContaining({ code: "CAPABILITY_PROBE_ALIAS_CAPABILITY_CONFLICT" }));
  expect(() => normalizeCapabilityProbeObservations([
    { ...snapshot, probeStableId: CORRECT_ID, probeSourceOrder: 1 },
    { ...snapshot, probeStableId: WRONG_ID, probeSourceOrder: 2, region: "middle" },
  ])).toThrow(expect.objectContaining({ code: "CAPABILITY_PROBE_ALIAS_CAPABILITY_CONFLICT" }));
  const tolerated = normalizeCapabilityProbeObservations([
    { ...snapshot, probeStableId: CORRECT_ID, probeSourceOrder: 1 },
    { ...snapshot, probeStableId: WRONG_ID, probeSourceOrder: 2, region: "middle" },
  ], { allowConflicts: true });
  expect(tolerated.liveDom).toHaveLength(1);
  expect(tolerated.aliases).toHaveLength(2);
  expect(tolerated.conflicts).toEqual([expect.objectContaining({
    operationStableId: PARENT_ID,
    probeStableIds: [CORRECT_ID, WRONG_ID],
    observations: [
      expect.objectContaining({
        probeStableId: CORRECT_ID,
        snapshot: expect.objectContaining({ region: "top" }),
      }),
      expect.objectContaining({
        probeStableId: WRONG_ID,
        snapshot: expect.objectContaining({ region: "middle" }),
      }),
    ],
  })]);
});

test("capability discovery excludes the authored canvas root with explicit product-contract proof", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent('<main data-runtime-root></main>');
  await page.locator("body").evaluate((element, stableId) => {
    element.setAttribute("data-stemmio-id", stableId);
  }, CORRECT_ID);
  const observation = await probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: {
      stableId: CORRECT_ID,
      tag: "body",
      sourceOrder: 0,
      sourceEditable: false,
      visible: true,
      isConnected: true,
      inert: false,
      runtimeGenerated: false,
      tabId: null,
      region: "top",
      scrollContainer: "document",
    },
    mode: "discover",
    sourceElements: [{
      stemmioId: CORRECT_ID,
      stemmioIdentityStatus: "valid",
      tagName: "body",
      parentId: null,
      sourceOrder: 0,
      sourceEditable: false,
    }],
  });
  expect(observation).toMatchObject({
    stableId: CORRECT_ID,
    probeReason: "AUTHORED_CANVAS_ROOT_NO_CAPABILITY",
    capabilityFamilies: [],
    behaviorFamilies: [],
    hitTest: { kind: "authored-canvas-root", tag: "body" },
  });
  expect(normalizeCapabilityProbeObservations([observation])).toMatchObject({
    liveDom: [],
    denominatorExclusions: [{
      elementId: CORRECT_ID,
      reason: "AUTHORED_CANVAS_ROOT_NO_CAPABILITY",
    }],
  });
});

test("capability probe accepts only the exact selected Stable ID", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await capabilityFixture(page);
  const editor = page.locator("[data-runtime-root]");
  const observed = await probeAuthoredCapability({
    page,
    frame: page,
    editor,
    candidate: candidate(),
  });
  expect(observed).toMatchObject({
    stableId: CORRECT_ID,
    selectedId: CORRECT_ID,
    probeReason: "CAPABILITY_OBSERVED",
  });
  expect(observed.capabilityFamilies).toEqual(expect.arrayContaining([
    "selection",
    "text",
    "format",
    "comment",
    "copy",
  ]));
  expect(observed.behaviorFamilies).toEqual(expect.arrayContaining([
    "bold",
    "italic",
    "underline",
    "font-size",
    "text-color",
    "fill-color",
    "padding",
    "margin",
    "line-height",
  ]));
  expect(await page.evaluate(() => window.__capabilityProbeAltKey)).toBe(false);
});

test("capability probe closes A's toolbar before the next exact click on B", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await capabilityFixture(page);
  const base = {
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
  };
  const first = await probeAuthoredCapability({ ...base, candidate: candidate(CORRECT_ID) });
  const second = await probeAuthoredCapability({ ...base, candidate: candidate(WRONG_ID) });
  expect(first).toMatchObject({ probeReason: "CAPABILITY_OBSERVED", selectedId: CORRECT_ID });
  expect(second).toMatchObject({
    probeReason: "CAPABILITY_OBSERVED",
    selectedId: WRONG_ID,
    selectionReset: {
      ok: true,
      reason: "PREVIOUS_SELECTION_CLEARED",
      selectedMarkerCount: 0,
      visibleToolbarCount: 0,
    },
  });
  expect(await page.evaluate(() => window.__capabilityProbeClickCount)).toBe(2);
});

test("capability reset uses a second Escape when the first only ends the active edit", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <main data-runtime-root>
      <p data-stemmio-id="${CORRECT_ID}" data-html-canvas-selected>editing</p>
      <div role="toolbar" aria-label="编辑正文" style="position:fixed;width:120px;height:40px"></div>
    </main>
  `);
  await page.evaluate(() => {
    let escapeCount = 0;
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      escapeCount += 1;
      if (escapeCount === 1) {
        document.querySelector("[data-html-canvas-selected]")
          ?.removeAttribute("data-html-canvas-selected");
      } else {
        document.querySelector('[role="toolbar"]')?.setAttribute("hidden", "");
      }
    });
  });
  await expect(resetAuthoredProbeSelection({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
  })).resolves.toMatchObject({
    ok: true,
    escapeAttemptCount: 2,
    selectedMarkerCount: 0,
    visibleToolbarCount: 0,
  });
});

test("capability probe fails closed before clicking when the prior overlay cannot clear", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await capabilityFixture(page, CORRECT_ID, "p", { resetOnEscape: false });
  await page.evaluate((stableId) => {
    document.querySelector(`[data-stemmio-id="${stableId}"]`)
      ?.setAttribute("data-html-canvas-selected", "");
    document.querySelector('[role="toolbar"]')?.removeAttribute("hidden");
  }, CORRECT_ID);
  const startedAt = Date.now();
  await expect(probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: candidate(),
  })).rejects.toMatchObject({
    code: "CAPABILITY_PROBE_SELECTION_NOT_CLEARED",
    details: {
      stableId: CORRECT_ID,
      selectionReset: {
        ok: false,
        reason: "PREVIOUS_SELECTION_OVERLAY_DID_NOT_CLOSE",
        selectedMarkerCount: 1,
        visibleToolbarCount: 1,
      },
    },
  });
  expect(Date.now() - startedAt).toBeLessThan(5_000);
  expect(await page.evaluate(() => window.__capabilityProbeClickCount)).toBe(0);
});

test("capability probe rejects stale and wrongly selected Stable IDs", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await capabilityFixture(page, WRONG_ID);
  const editor = page.locator("[data-runtime-root]");
  await expect(probeAuthoredCapability({
    page,
    frame: page,
    editor,
    candidate: candidate(),
  })).rejects.toMatchObject({
    code: "CAPABILITY_PROBE_SELECTION_IDENTITY_MISMATCH",
    details: {
      expectedStableId: CORRECT_ID,
      selectedId: WRONG_ID,
      selectedSnapshot: {
        selectedCount: 1,
        selectedId: WRONG_ID,
        selectedContainsExpected: false,
        expectedContainsSelected: false,
      },
    },
  });

  await expect(probeAuthoredCapability({
    page,
    frame: page,
    editor,
    candidate: candidate("sm1_cccccccccccccccccccccccccccccccc"),
  })).rejects.toMatchObject({
    code: "CAPABILITY_PROBE_STALE_STABLE_ID",
    details: { count: 0 },
  });
});

test("selection snapshot failure preserves the original identity mismatch and pointer facts", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await capabilityFixture(page, WRONG_ID);
  await expect(probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: candidate(),
    selectedSnapshotReader: async () => {
      throw new Error("detached diagnostic frame");
    },
  })).rejects.toMatchObject({
    code: "CAPABILITY_PROBE_SELECTION_IDENTITY_MISMATCH",
    details: {
      expectedStableId: CORRECT_ID,
      hostPointer: {
        accepted: true,
        hitKind: "authored-target",
      },
      selectedSnapshot: {
        available: false,
        reasonCode: "SELECTION_SNAPSHOT_UNAVAILABLE",
      },
    },
  });
});

test("capability probe uses a bounded real mouse hit for a continuously moving target", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await capabilityFixture(page);
  await page.locator("#target").evaluate((element) => {
    element.animate(
      [{ transform: "translateX(0px)" }, { transform: "translateX(2px)" }],
      { duration: 40, iterations: Infinity, direction: "alternate" },
    );
  });
  const startedAt = Date.now();
  const observed = await probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: candidate(),
  });
  expect(observed).toMatchObject({ probeReason: "CAPABILITY_OBSERVED", selectedId: CORRECT_ID });
  expect(Date.now() - startedAt).toBeLessThan(5_000);
});

test("capability probe finds a natural parent hit outside a rounded descendant", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <main data-runtime-root data-element-copy-availability="available" data-element-copy-reason="available">
      <section id="rounded-parent" data-stemmio-id="${PARENT_ID}" style="display:block;width:240px;height:80px">
        <span data-stemmio-id="${CORRECT_ID}" style="display:block;width:100%;height:100%;border-radius:40px">rounded cover</span>
      </section>
      <div role="toolbar" aria-label="元素工具栏" hidden><button aria-label="编辑"></button></div>
    </main>
  `);
  await page.locator("#rounded-parent").evaluate((element) => {
    element.addEventListener("click", () => {
      element.setAttribute("data-html-canvas-selected", "");
      document.querySelector('[role="toolbar"]')?.removeAttribute("hidden");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      element.removeAttribute("data-html-canvas-selected");
      document.querySelector('[role="toolbar"]')?.setAttribute("hidden", "");
    });
  });
  const observed = await probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: { ...candidate(PARENT_ID), tag: "section", sourceOrder: 0 },
    mode: "discover",
    sourceElements: [
      {
        stemmioId: PARENT_ID,
        stemmioIdentityStatus: "valid",
        parentId: null,
        tagName: "section",
        sourceOrder: 0,
        sourceEditable: false,
      },
      {
        stemmioId: CORRECT_ID,
        stemmioIdentityStatus: "valid",
        parentId: PARENT_ID,
        tagName: "span",
        sourceOrder: 1,
        sourceEditable: false,
      },
    ],
  });
  expect(observed).toMatchObject({
    stableId: PARENT_ID,
    operationStableId: PARENT_ID,
    probeReason: "CAPABILITY_OBSERVED",
  });
});

test("capability probe excludes a source-proven wrapper covered by unique authored descendants without clicking", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <main data-runtime-root>
      <section id="wrapper" data-stemmio-id="${PARENT_ID}" style="display:block;width:240px;height:80px">
        <span data-stemmio-id="${CORRECT_ID}" style="display:block;width:100%;height:100%">covered</span>
      </section>
      <div role="toolbar" hidden></div>
    </main>
  `);
  await page.evaluate(() => {
    window.__capabilityProbeClickCount = 0;
    document.addEventListener("click", () => { window.__capabilityProbeClickCount += 1; });
  });
  const observed = await probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: { ...candidate(PARENT_ID), tag: "section", sourceOrder: 0 },
    mode: "discover",
    sourceElements: [
      {
        stemmioId: PARENT_ID,
        stemmioIdentityStatus: "valid",
        parentId: null,
        tagName: "section",
        sourceOrder: 0,
        sourceEditable: false,
      },
      {
        stemmioId: CORRECT_ID,
        stemmioIdentityStatus: "valid",
        parentId: PARENT_ID,
        tagName: "span",
        sourceOrder: 1,
        sourceEditable: false,
      },
    ],
  });
  expect(observed).toMatchObject({
    stableId: PARENT_ID,
    probeReason: "AUTHORED_DESCENDANT_OCCLUSION",
    capabilityFamilies: [],
    behaviorFamilies: [],
    hitTest: {
      kind: "valid-descendant-occlusion",
      sampleCount: 25,
      validSampleCount: 25,
      descendantStableIds: [CORRECT_ID],
      sourceAncestorVerified: true,
      liveUniqueVerified: true,
      coverageVerified: true,
      coverageKind: "single-untransformed-hit-box",
      coverageStableIds: [CORRECT_ID],
    },
  });
  expect(await page.evaluate(() => window.__capabilityProbeClickCount)).toBe(0);
});

test("capability probe still validates selection when bounded geometry finds an exact sparse-wrapper point", HARNESS_TEST_OPTIONS, async ({ page }) => {
  const fractions = [0.08, 0.2, 0.5, 0.8, 0.92];
  const descendantIds = fractions.flatMap((_, row) => fractions.map((__, column) => (
    `sm1_${(row * fractions.length + column + 100).toString(16).padStart(32, "0")}`
  )));
  const dots = descendantIds.map((stableId, index) => {
    const row = Math.floor(index / fractions.length);
    const column = index % fractions.length;
    return `<span data-stemmio-id="${stableId}" style="position:absolute;left:calc(${fractions[column] * 100}% - 3px);top:calc(${fractions[row] * 100}% - 3px);width:6px;height:6px"></span>`;
  }).join("");
  await page.setContent(`
    <main data-runtime-root>
      <section data-stemmio-id="${PARENT_ID}" style="position:relative;display:block;width:240px;height:100px">
        ${dots}
      </section>
      <div role="toolbar" hidden></div>
    </main>
  `);
  await page.evaluate(() => {
    window.__capabilityProbeClickCount = 0;
    document.addEventListener("click", () => { window.__capabilityProbeClickCount += 1; });
  });
  await expect(probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: { ...candidate(PARENT_ID), tag: "section", sourceOrder: 0 },
    mode: "discover",
    sourceElements: [
      {
        stemmioId: PARENT_ID,
        stemmioIdentityStatus: "valid",
        parentId: null,
        tagName: "section",
        sourceOrder: 0,
        sourceEditable: false,
      },
      ...descendantIds.map((stableId, index) => ({
        stemmioId: stableId,
        stemmioIdentityStatus: "valid",
        parentId: PARENT_ID,
        tagName: "span",
        sourceOrder: index + 1,
        sourceEditable: false,
      })),
    ],
  })).rejects.toMatchObject({ code: "CAPABILITY_PROBE_SELECTION_IDENTITY_MISMATCH" });
  expect(await page.evaluate(() => window.__capabilityProbeClickCount)).toBeGreaterThan(0);
});

test("capability probe accepts exact rectangular union coverage from proven authored descendants", HARNESS_TEST_OPTIONS, async ({ page }) => {
  const leftId = "sm1_dddddddddddddddddddddddddddddddd";
  const rightId = "sm1_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  await page.setContent(`
    <main data-runtime-root>
      <section data-stemmio-id="${PARENT_ID}" style="display:flex;width:240px;height:100px">
        <span data-stemmio-id="${leftId}" style="display:block;width:50%;height:100%"></span>
        <span data-stemmio-id="${rightId}" style="display:block;width:50%;height:100%"></span>
      </section>
      <div role="toolbar" hidden></div>
    </main>
  `);
  const observed = await probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: { ...candidate(PARENT_ID), tag: "section", sourceOrder: 0 },
    mode: "discover",
    sourceElements: [
      {
        stemmioId: PARENT_ID,
        stemmioIdentityStatus: "valid",
        parentId: null,
        tagName: "section",
        sourceOrder: 0,
        sourceEditable: false,
      },
      ...[leftId, rightId].map((stableId, index) => ({
        stemmioId: stableId,
        stemmioIdentityStatus: "valid",
        parentId: PARENT_ID,
        tagName: "span",
        sourceOrder: index + 1,
        sourceEditable: false,
      })),
    ],
  });
  expect(observed).toMatchObject({
    probeReason: "AUTHORED_DESCENDANT_OCCLUSION",
    hitTest: {
      coverageVerified: true,
      coverageKind: "union-untransformed-hit-boxes",
      coverageStableIds: [leftId, rightId],
    },
  });
});

test("capability probe keeps an unproved dedicated-child wrapper explicit", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <main data-runtime-root>
      <div id="target" data-stemmio-id="${PARENT_ID}" style="width:204px">
        <canvas data-stemmio-id="${CORRECT_ID}" style="display:block;width:200px;height:80px;margin:2px;pointer-events:none"></canvas>
      </div>
      <div role="toolbar" aria-label="元素工具栏" hidden></div>
    </main>
  `);
  await page.evaluate((selectedId) => {
    document.addEventListener("click", () => {
      document.querySelector(`[data-stemmio-id="${selectedId}"]`)
        ?.setAttribute("data-html-canvas-selected", "part");
      document.querySelector('[role="toolbar"]')?.removeAttribute("hidden");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      document.querySelectorAll("[data-html-canvas-selected]")
        .forEach((element) => element.removeAttribute("data-html-canvas-selected"));
      document.querySelector('[role="toolbar"]')?.setAttribute("hidden", "");
    });
  }, CORRECT_ID);
  const sourceElements = [
    {
      stemmioId: PARENT_ID,
      stemmioIdentityStatus: "valid",
      parentId: null,
      tagName: "div",
      sourceOrder: 0,
      sourceEditable: false,
    },
    {
      stemmioId: CORRECT_ID,
      stemmioIdentityStatus: "valid",
      parentId: PARENT_ID,
      tagName: "canvas",
      sourceOrder: 1,
      sourceEditable: false,
    },
  ];

  const observed = await probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: {
      ...candidate(PARENT_ID),
      tag: "div",
      sourceEditable: false,
      sourceOrder: 0,
    },
    mode: "discover",
    sourceElements,
  });

  expect(observed).toMatchObject({
    stableId: PARENT_ID,
    probeReason: "NO_EXACT_HIT_POINT",
    visible: false,
    hitTest: {
      kind: "blocked",
    },
  });
});

test("capability probe finds the narrow parent border outside dedicated child tolerance", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <main data-runtime-root data-element-copy-availability="available" data-element-copy-reason="available">
      <div id="target" data-stemmio-id="${PARENT_ID}" style="width:453px;height:260px">
        <video data-stemmio-id="${CORRECT_ID}" style="display:block;width:453px;height:254px;margin:3px 0;pointer-events:none"></video>
      </div>
      <div role="toolbar" aria-label="元素工具栏" hidden>
        <button aria-label="留评论"></button>
      </div>
    </main>
  `);
  await page.evaluate(({ parentId, childId }) => {
    document.addEventListener("click", (event) => {
      const child = document.querySelector(`[data-stemmio-id="${childId}"]`);
      const rect = child.getBoundingClientRect();
      const dedicatedHit = event.clientX >= rect.left - 2
        && event.clientX <= rect.right + 2
        && event.clientY >= rect.top - 2
        && event.clientY <= rect.bottom + 2;
      document.querySelector(`[data-stemmio-id="${dedicatedHit ? childId : parentId}"]`)
        ?.setAttribute("data-html-canvas-selected", "part");
      document.querySelector('[role="toolbar"]')?.removeAttribute("hidden");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      document.querySelectorAll("[data-html-canvas-selected]")
        .forEach((element) => element.removeAttribute("data-html-canvas-selected"));
      document.querySelector('[role="toolbar"]')?.setAttribute("hidden", "");
    });
  }, { parentId: PARENT_ID, childId: CORRECT_ID });
  const sourceElements = [
    {
      stemmioId: PARENT_ID,
      stemmioIdentityStatus: "valid",
      parentId: null,
      tagName: "div",
      sourceOrder: 0,
      sourceEditable: false,
    },
    {
      stemmioId: CORRECT_ID,
      stemmioIdentityStatus: "valid",
      parentId: PARENT_ID,
      tagName: "video",
      sourceOrder: 1,
      sourceEditable: false,
    },
  ];

  const observed = await probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: {
      ...candidate(PARENT_ID),
      tag: "div",
      sourceEditable: false,
      sourceOrder: 0,
    },
    mode: "discover",
    sourceElements,
  });

  expect(observed).toMatchObject({
    stableId: PARENT_ID,
    selectedId: PARENT_ID,
    probeReason: "CAPABILITY_OBSERVED",
  });
});

test("capability probe blocks a descendant-covered wrapper when source ancestry is unproven", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <main data-runtime-root>
      <section data-stemmio-id="${PARENT_ID}" style="display:block;width:240px;height:80px">
        <span data-stemmio-id="${CORRECT_ID}" style="display:block;width:100%;height:100%">covered</span>
      </section>
      <div role="toolbar" hidden></div>
    </main>
  `);
  await page.evaluate(() => {
    window.__capabilityProbeClickCount = 0;
    document.addEventListener("click", () => { window.__capabilityProbeClickCount += 1; });
  });
  const observed = await probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: { ...candidate(PARENT_ID), tag: "section", sourceOrder: 0 },
    mode: "discover",
    sourceElements: [
      {
        stemmioId: PARENT_ID,
        stemmioIdentityStatus: "valid",
        parentId: null,
        tagName: "section",
        sourceOrder: 0,
        sourceEditable: false,
      },
      {
        stemmioId: CORRECT_ID,
        stemmioIdentityStatus: "valid",
        parentId: null,
        tagName: "span",
        sourceOrder: 1,
        sourceEditable: false,
      },
    ],
  });
  expect(observed).toMatchObject({
    probeReason: "NO_EXACT_HIT_POINT",
    hitTest: { kind: "blocked", hitKind: "unproven-descendant" },
  });
  expect(await page.evaluate(() => window.__capabilityProbeClickCount)).toBe(0);
});

test("capability probe rejects a foreign hit interceptor without force-clicking", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await capabilityFixture(page);
  await page.locator("#target").evaluate((element) => {
    const interceptor = document.createElement("div");
    interceptor.id = "foreign-interceptor";
    Object.assign(interceptor.style, {
      position: "absolute",
      left: `${element.offsetLeft}px`,
      top: `${element.offsetTop}px`,
      width: `${element.offsetWidth}px`,
      height: `${element.offsetHeight}px`,
      zIndex: "9",
    });
    document.body.append(interceptor);
  });
  const startedAt = Date.now();
  const observed = await probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: candidate(),
  });
  expect(observed).toMatchObject({
    capabilityFamilies: [],
    behaviorFamilies: [],
    probeReason: "AUTHORED_FOREIGN_SURFACE_OCCLUSION",
    hitTest: {
      kind: "valid-foreign-occlusion",
      coverageVerified: true,
    },
  });
  expect(Date.now() - startedAt).toBeLessThan(5_000);
  expect(await page.evaluate(() => window.__capabilityProbeClickCount)).toBe(0);
});

test("capability probe leaves mixed authored pointer occlusion explicitly unproven", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <main data-runtime-root style="position:relative;width:240px;height:80px">
      <section data-stemmio-id="${PARENT_ID}" style="display:block;width:240px;height:80px">
        <span data-stemmio-id="${CORRECT_ID}" style="display:block;width:120px;height:80px">left cover</span>
      </section>
      <div data-stemmio-id="${WRONG_ID}" style="position:absolute;z-index:2;left:120px;top:0;width:120px;height:80px">right cover</div>
      <div role="toolbar" hidden></div>
    </main>
  `);
  await page.evaluate(() => {
    window.__capabilityProbeClickCount = 0;
    document.addEventListener("click", () => { window.__capabilityProbeClickCount += 1; });
  });
  const observed = await probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: { ...candidate(PARENT_ID), tag: "section", sourceOrder: 0 },
    mode: "discover",
    sourceElements: [
      {
        stemmioId: PARENT_ID,
        stemmioIdentityStatus: "valid",
        parentId: null,
        tagName: "section",
        sourceOrder: 0,
        sourceEditable: false,
      },
      {
        stemmioId: CORRECT_ID,
        stemmioIdentityStatus: "valid",
        parentId: PARENT_ID,
        tagName: "span",
        sourceOrder: 1,
        sourceEditable: false,
      },
      {
        stemmioId: WRONG_ID,
        stemmioIdentityStatus: "valid",
        parentId: null,
        tagName: "div",
        sourceOrder: 2,
        sourceEditable: false,
      },
    ],
  });
  expect(observed).toMatchObject({
    stableId: PARENT_ID,
    probeReason: "NO_EXACT_HIT_POINT",
    hitTest: {
      kind: "blocked",
      hitKind: "stable-id-non-descendant",
      foreignCoverageDiagnostic: { coverageVerified: false },
    },
  });
  expect(await page.evaluate(() => window.__capabilityProbeClickCount)).toBe(0);
});

test("capability probe rejects an iframe host overlay that appears on pointer move", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <style>
      iframe { width: 320px; height: 180px; border: 0; }
      #host-overlay { position: fixed; left: 8px; top: 8px; width: 320px; height: 180px; z-index: 20; }
    </style>
    <main data-runtime-root data-element-copy-availability="available" data-element-copy-reason="available">
      <iframe data-runtime-slot-role="active"></iframe>
      <div id="host-overlay" hidden></div>
      <div role="toolbar" aria-label="元素工具栏" hidden></div>
    </main>
  `);
  const iframeElement = await page.locator("iframe").elementHandle();
  const child = await iframeElement.contentFrame();
  await child.setContent(`
    <p id="target" data-stemmio-id="${CORRECT_ID}" style="display:block;width:240px;height:80px">
      iframe authored target
    </p>
  `);
  await child.locator("#target").evaluate((element) => {
    window.__capabilityProbeClickCount = 0;
    element.addEventListener("click", () => {
      window.__capabilityProbeClickCount += 1;
      element.setAttribute("data-html-canvas-selected", "");
    });
  });
  await page.locator("iframe").evaluate((iframe) => {
    iframe.addEventListener("mouseenter", () => {
      document.querySelector("#host-overlay")?.removeAttribute("hidden");
    });
  });
  const startedAt = Date.now();
  await expect(probeAuthoredCapability({
    page,
    frame: child,
    editor: page.locator("[data-runtime-root]"),
    candidate: candidate(),
  })).rejects.toMatchObject({
    code: "CAPABILITY_PROBE_HOST_POINTER_INTERCEPTED",
    details: {
      stableId: CORRECT_ID,
      hitKind: "div",
      hostPointer: { accepted: false, hitKind: "div" },
    },
  });
  expect(Date.now() - startedAt).toBeLessThan(5_000);
  expect(await child.evaluate(() => window.__capabilityProbeClickCount)).toBe(0);
});

async function installIframeCapabilityHintFixture(page, {
  hintTargetId = CORRECT_ID,
  hintTargetDomGeneration = "11",
  hintCurrentDomGeneration = "11",
  hintActiveFrameGeneration = "7",
  selectedId = CORRECT_ID,
} = {}) {
  await page.setContent(`
    <style>
      iframe { width: 320px; height: 180px; border: 0; }
      [data-testid="canvas-capability-hint"] {
        position: fixed; left: 8px; top: 8px; width: 320px; height: 180px; z-index: 20;
      }
    </style>
    <main data-runtime-root data-element-copy-availability="available" data-element-copy-reason="available">
      <iframe data-runtime-slot-role="active" data-frame-generation="7"></iframe>
      <button
        data-testid="canvas-capability-hint"
        data-capability-target-id="${hintTargetId}"
        data-capability-target-key="element:${hintTargetId}"
        data-capability-target-dom-generation="${hintTargetDomGeneration}"
        data-capability-current-dom-generation="${hintCurrentDomGeneration}"
        data-capability-active-frame-generation="${hintActiveFrameGeneration}"
        hidden
      >Select exact target</button>
      <div role="toolbar" aria-label="元素工具栏" hidden>
        <button aria-label="留评论"></button>
        <button aria-label="编辑"></button>
        <button aria-label="复制元素"></button>
      </div>
    </main>
  `);
  const iframeElement = await page.locator("iframe").elementHandle();
  const child = await iframeElement.contentFrame();
  await child.setContent(`
    <p id="target" data-stemmio-id="${CORRECT_ID}" style="display:block;width:240px;height:80px">
      iframe authored target
    </p>
    <p data-stemmio-id="${WRONG_ID}">wrong target</p>
  `);
  await page.evaluate((nextSelectedId) => {
    window.__capabilityHintClickCount = 0;
    const iframe = document.querySelector("iframe");
    const hint = document.querySelector('[data-testid="canvas-capability-hint"]');
    iframe?.addEventListener("mouseenter", () => hint?.removeAttribute("hidden"));
    hint?.addEventListener("click", () => {
      window.__capabilityHintClickCount += 1;
      const childDocument = iframe?.contentDocument;
      childDocument?.querySelectorAll("[data-html-canvas-selected]")
        .forEach((element) => element.removeAttribute("data-html-canvas-selected"));
      childDocument?.querySelector(`[data-stemmio-id="${nextSelectedId}"]`)
        ?.setAttribute("data-html-canvas-selected", "subregion");
      document.querySelector('[role="toolbar"]')?.removeAttribute("hidden");
    });
  }, selectedId);
  await page.mouse.move(0, 0);
  return child;
}

test("capability probe accepts an exact product hover hint when DOM generation validly differs from frame generation", HARNESS_TEST_OPTIONS, async ({ page }) => {
  const child = await installIframeCapabilityHintFixture(page);
  const observed = await probeAuthoredCapability({
    page,
    frame: child,
    editor: page.locator("[data-runtime-root]"),
    candidate: candidate(),
  });
  expect(observed).toMatchObject({
    probeReason: "CAPABILITY_OBSERVED",
    selectedId: CORRECT_ID,
  });
  expect(await page.evaluate(() => window.__capabilityHintClickCount)).toBe(1);
});

test("capability probe rejects wrong-target, stale-frame, and stale-DOM product hover hints before click", HARNESS_TEST_OPTIONS, async ({ page }) => {
  const child = await installIframeCapabilityHintFixture(page, { hintTargetId: WRONG_ID });
  const input = {
    page,
    frame: child,
    editor: page.locator("[data-runtime-root]"),
    candidate: candidate(),
  };
  await expect(probeAuthoredCapability(input)).rejects.toMatchObject({
    code: "CAPABILITY_PROBE_HOST_POINTER_INTERCEPTED",
    details: {
      hitKind: "capability-hint-identity-mismatch",
      hostPointer: {
        hintTargetId: WRONG_ID,
        hintTargetDomGeneration: "11",
        hintCurrentDomGeneration: "11",
        hintActiveFrameGeneration: "7",
      },
    },
  });
  expect(await page.evaluate(() => window.__capabilityHintClickCount)).toBe(0);

  await page.getByTestId("canvas-capability-hint").evaluate((hint, stableId) => {
    hint.setAttribute("data-capability-target-id", stableId);
    hint.setAttribute("data-capability-target-key", `element:${stableId}`);
    hint.setAttribute("data-capability-active-frame-generation", "6");
  }, CORRECT_ID);
  await expect(probeAuthoredCapability(input)).rejects.toMatchObject({
    code: "CAPABILITY_PROBE_HOST_POINTER_INTERCEPTED",
    details: { hitKind: "capability-hint-identity-mismatch" },
  });
  expect(await page.evaluate(() => window.__capabilityHintClickCount)).toBe(0);

  await page.getByTestId("canvas-capability-hint").evaluate((hint) => {
    hint.setAttribute("data-capability-active-frame-generation", "7");
    hint.setAttribute("data-capability-target-dom-generation", "10");
    hint.setAttribute("data-capability-current-dom-generation", "11");
  });
  await expect(probeAuthoredCapability(input)).rejects.toMatchObject({
    code: "CAPABILITY_PROBE_HOST_POINTER_INTERCEPTED",
    details: { hitKind: "capability-hint-identity-mismatch" },
  });
  expect(await page.evaluate(() => window.__capabilityHintClickCount)).toBe(0);
});

test("capability probe rejects every incomplete product hover generation diagnostic before click", HARNESS_TEST_OPTIONS, async ({ page }) => {
  const missingGenerationCases = [
    ["[data-runtime-slot-role=active]", "data-frame-generation"],
    ["[data-testid=canvas-capability-hint]", "data-capability-target-dom-generation"],
    ["[data-testid=canvas-capability-hint]", "data-capability-current-dom-generation"],
    ["[data-testid=canvas-capability-hint]", "data-capability-active-frame-generation"],
  ];
  for (const [selector, attribute] of missingGenerationCases) {
    const child = await installIframeCapabilityHintFixture(page);
    await page.locator(selector).evaluate((element, name) => element.removeAttribute(name), attribute);
    await expect(probeAuthoredCapability({
      page,
      frame: child,
      editor: page.locator("[data-runtime-root]"),
      candidate: candidate(),
    })).rejects.toMatchObject({
      code: "CAPABILITY_PROBE_HOST_POINTER_INTERCEPTED",
      details: { hitKind: "capability-hint-identity-mismatch" },
    });
    expect(await page.evaluate(() => window.__capabilityHintClickCount)).toBe(0);
  }

  for (const invalidGeneration of ["01", "9007199254740992"]) {
    const invalidChild = await installIframeCapabilityHintFixture(page, {
      hintTargetDomGeneration: invalidGeneration,
      hintCurrentDomGeneration: invalidGeneration,
    });
    await expect(probeAuthoredCapability({
      page,
      frame: invalidChild,
      editor: page.locator("[data-runtime-root]"),
      candidate: candidate(),
    })).rejects.toMatchObject({
      code: "CAPABILITY_PROBE_HOST_POINTER_INTERCEPTED",
      details: { hitKind: "capability-hint-identity-mismatch" },
    });
    expect(await page.evaluate(() => window.__capabilityHintClickCount)).toBe(0);
  }
});

test("capability probe reports a same-ID wrong DOM tag instead of echoing the frozen tag", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await capabilityFixture(page, CORRECT_ID, "section");
  const observed = await probeAuthoredCapability({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    candidate: candidate(),
  });
  expect(observed).toMatchObject({
    stableId: CORRECT_ID,
    selectedId: CORRECT_ID,
    tag: "section",
    probeReason: "CAPABILITY_OBSERVED",
  });
  expect(observed.tag).not.toBe(candidate().tag);
  expect(observed.selectedId === CORRECT_ID && observed.tag === candidate().tag)
    .toBe(false);
});

test("capability census keeps only the currently reachable authored tab content", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <section id="tab-a"><p data-stemmio-id="${CORRECT_ID}">A</p></section>
    <section id="tab-b" hidden><p data-stemmio-id="${WRONG_ID}">B</p></section>
  `);
  const sourceElements = [CORRECT_ID, WRONG_ID].map((stemmioId) => ({
    stemmioId,
    sourceEditable: true,
  }));
  const first = await collectVisibleAuthoredCandidates(page, sourceElements, "tab-a");
  expect(first.filter((entry) => entry.visible).map((entry) => entry.stableId))
    .toEqual([CORRECT_ID]);
  expect(first.find((entry) => entry.stableId === WRONG_ID)?.visible).toBe(false);

  await page.evaluate(() => {
    document.querySelector("#tab-a").hidden = true;
    document.querySelector("#tab-b").hidden = false;
  });
  const second = await collectVisibleAuthoredCandidates(page, sourceElements, "tab-b");
  expect(second.filter((entry) => entry.visible).map((entry) => entry.stableId))
    .toEqual([WRONG_ID]);
});

test("Runtime-generated discovery trusts controller diagnostics and freezes one target per kind", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <main data-runtime-root>
      <section data-stemmio-id="${CORRECT_ID}">
        <table id="runtime-table"><tbody><tr><td>runtime</td></tr></tbody></table>
        <table id="same-kind-runtime-table"><tbody><tr><td>runtime 2</td></tr></tbody></table>
      </section>
    </main>
  `);
  const editor = page.locator("[data-runtime-root]");
  await installRuntimeDiagnosticReset(page);
  for (const [index, id] of ["runtime-table", "same-kind-runtime-table"].entries()) {
    await page.locator(`#${id}`).evaluate((element, payload) => {
      element.addEventListener("click", () => {
        const root = document.querySelector("[data-runtime-root]");
        root.setAttribute("data-selection-runtime-generated", "true");
        root.setAttribute("data-selection-runtime-generation", "7");
        root.setAttribute("data-selection-runtime-source-anchor-id", payload.anchorId);
        root.setAttribute("data-selection-runtime-kind", "table");
        root.setAttribute(
          "data-selection-runtime-path",
          payload.index === 0 ? "table:nth-of-type(1)" : "table:nth-of-type(2)",
        );
      });
    }, { anchorId: CORRECT_ID, index });
  }
  const frozen = await discoverRuntimeGeneratedTargets({ page, frame: page, editor, tabId: "tab-a" });
  expect(frozen.diagnostics).toMatchObject({
    candidateCount: 4,
    runtimeGeneratedCount: 4,
    frozenTargetCount: 1,
    rejectedDiagnosticCount: 0,
    truncated: false,
    firstFailure: null,
  });
  expect(frozen.targets).toEqual([{
    targetKey: `${CORRECT_ID}:table:table:nth-of-type(1)`,
    tabId: "tab-a",
    generation: "7",
    sourceAnchorId: CORRECT_ID,
    kind: "table",
    relativePath: "table:nth-of-type(1)",
    capabilityFamilies: ["comment"],
    deniedCapabilityFamilies: ["text", "format", "copy", "move", "delete"],
  }]);
  expect(runtimeGeneratedDiagnosticsIssue([frozen.diagnostics])).toBeNull();
});

test("Runtime-generated discovery clicks an active-frame SVG through its descendant with a real mouse", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <style>iframe { width:320px; height:180px; border:0; }</style>
    <main data-runtime-root><iframe data-runtime-slot-role="active" data-frame-generation="7"></iframe></main>
  `);
  await installRuntimeDiagnosticReset(page);
  const iframeElement = await page.locator("iframe").elementHandle();
  const child = await iframeElement.contentFrame();
  await child.setContent(`
    <section data-stemmio-id="${CORRECT_ID}">
      <svg id="runtime-svg" width="240" height="100"><rect width="240" height="100"></rect></svg>
    </section>
  `);
  await child.locator("#runtime-svg").evaluate((element, anchorId) => {
    window.__runtimeProbeClickCount = 0;
    element.addEventListener("click", () => {
      window.__runtimeProbeClickCount += 1;
      const root = window.parent.document.querySelector("[data-runtime-root]");
      root.setAttribute("data-selection-runtime-generated", "true");
      root.setAttribute("data-selection-runtime-generation", "7");
      root.setAttribute("data-selection-runtime-source-anchor-id", anchorId);
      root.setAttribute("data-selection-runtime-kind", "svg");
      root.setAttribute("data-selection-runtime-path", "svg");
    });
  }, CORRECT_ID);
  const frozen = await discoverRuntimeGeneratedTargets({
    page,
    frame: child,
    editor: page.locator("[data-runtime-root]"),
    tabId: null,
  });
  expect(frozen.diagnostics).toMatchObject({
    candidateCount: 1,
    probedCount: 1,
    runtimeGeneratedCount: 1,
    frozenTargetCount: 1,
    probeFailureCount: 0,
    firstFailure: null,
  });
  expect(await child.evaluate(() => window.__runtimeProbeClickCount)).toBe(1);
});

test("Runtime-generated discovery uses a natural ancestor hit for a pointer-transparent SVG", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <main data-runtime-root>
      <section data-stemmio-id="${CORRECT_ID}">
        <svg id="transparent-svg" width="240" height="100" style="pointer-events:none"><rect width="240" height="100"></rect></svg>
      </section>
    </main>
  `);
  await installRuntimeDiagnosticReset(page);
  await page.evaluate((anchorId) => {
    window.__runtimeProbeClickCount = 0;
    const section = document.querySelector("section");
    section.addEventListener("click", () => {
      window.__runtimeProbeClickCount += 1;
      const root = document.querySelector("[data-runtime-root]");
      root.setAttribute("data-selection-runtime-generated", "true");
      root.setAttribute("data-selection-runtime-generation", "7");
      root.setAttribute("data-selection-runtime-source-anchor-id", anchorId);
      root.setAttribute("data-selection-runtime-kind", "svg");
      root.setAttribute("data-selection-runtime-path", "svg");
    });
  }, CORRECT_ID);
  const frozen = await discoverRuntimeGeneratedTargets({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    tabId: null,
  });
  expect(frozen.targets).toHaveLength(1);
  expect(frozen.targets[0]).toMatchObject({
    sourceAnchorId: CORRECT_ID,
    kind: "svg",
    relativePath: "svg",
  });
  expect(frozen.diagnostics).toMatchObject({
    candidateCount: 1,
    probedCount: 1,
    runtimeGeneratedCount: 1,
    frozenTargetCount: 1,
    probeFailureCount: 0,
    firstFailure: null,
  });
  expect(await page.evaluate(() => window.__runtimeProbeClickCount)).toBe(1);
});

test("Runtime-generated discovery rejects an active-frame host overlay without clicking", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <style>
      iframe { width:320px; height:180px; border:0; }
      #host-overlay { position:fixed; left:8px; top:8px; width:320px; height:180px; z-index:20; }
    </style>
    <main data-runtime-root>
      <iframe data-runtime-slot-role="active" data-frame-generation="7"></iframe>
      <div id="host-overlay" hidden></div>
    </main>
  `);
  await installRuntimeDiagnosticReset(page);
  const iframeElement = await page.locator("iframe").elementHandle();
  const child = await iframeElement.contentFrame();
  await child.setContent(`
    <section data-stemmio-id="${CORRECT_ID}">
      <svg id="runtime-svg" width="240" height="100"><rect width="240" height="100"></rect></svg>
    </section>
  `);
  await child.locator("#runtime-svg").evaluate((element) => {
    window.__runtimeProbeClickCount = 0;
    element.addEventListener("click", () => { window.__runtimeProbeClickCount += 1; });
  });
  await page.locator("iframe").evaluate((iframe) => {
    iframe.addEventListener("mouseenter", () => {
      document.querySelector("#host-overlay")?.removeAttribute("hidden");
    });
  });
  const frozen = await discoverRuntimeGeneratedTargets({
    page,
    frame: child,
    editor: page.locator("[data-runtime-root]"),
    tabId: null,
  });
  expect(frozen.targets).toEqual([]);
  expect(frozen.diagnostics).toMatchObject({
    probedCount: 0,
    probeFailureCount: 1,
    firstFailure: {
      substage: "target-click",
      code: "RUNTIME_PROBE_HOST_POINTER_INTERCEPTED",
      hitKind: "div",
    },
  });
  expect(await child.evaluate(() => window.__runtimeProbeClickCount)).toBe(0);
});

test("Runtime-generated discovery records an authored-only page without a probe failure", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <main data-runtime-root>
      <section data-stemmio-id="${CORRECT_ID}">
        <table id="authored-only-table"><tbody><tr><td>authored</td></tr></tbody></table>
      </section>
    </main>
  `);
  await installRuntimeDiagnosticReset(page);
  await page.locator("#authored-only-table").evaluate((element) => {
    for (const target of [element, ...element.querySelectorAll("td")]) {
      target.addEventListener("click", () => {
        document.querySelector("[data-runtime-root]")
          ?.setAttribute("data-selection-runtime-generated", "false");
      });
    }
  });
  const frozen = await discoverRuntimeGeneratedTargets({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    tabId: "tab-a",
  });
  expect(frozen.targets).toEqual([]);
  expect(frozen.diagnostics).toMatchObject({
    candidateCount: 2,
    probedCount: 2,
    visibleCount: 2,
    runtimeGeneratedCount: 0,
    frozenTargetCount: 0,
    rejectedDiagnosticCount: 0,
    probeFailureCount: 0,
    firstFailure: null,
  });
  expect(runtimeGeneratedDiagnosticsIssue([frozen.diagnostics])).toBeNull();
});

test("Runtime-generated discovery rejects incomplete diagnostics and authored visual targets", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <main data-runtime-root>
      <section data-stemmio-id="${CORRECT_ID}">
        <table id="authored-table"><tbody><tr><td>authored</td></tr></tbody></table>
        <table id="incomplete-runtime-table"><tbody><tr><td>runtime</td></tr></tbody></table>
      </section>
    </main>
  `);
  await installRuntimeDiagnosticReset(page);
  await page.locator("#authored-table").evaluate((element) => {
    element.addEventListener("click", () => {
      const root = document.querySelector("[data-runtime-root]");
      root.setAttribute("data-selection-runtime-generated", "false");
    });
  });
  await page.locator("#incomplete-runtime-table").evaluate((element, anchorId) => {
    element.addEventListener("click", () => {
      const root = document.querySelector("[data-runtime-root]");
      root.setAttribute("data-selection-runtime-generated", "true");
      root.setAttribute("data-selection-runtime-generation", "7");
      root.setAttribute("data-selection-runtime-source-anchor-id", anchorId);
      root.setAttribute("data-selection-runtime-kind", "table");
    });
  }, CORRECT_ID);
  const frozen = await discoverRuntimeGeneratedTargets({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    tabId: "tab-a",
  });
  expect(frozen.targets).toEqual([]);
  expect(frozen.diagnostics).toMatchObject({
    candidateCount: 4,
    runtimeGeneratedCount: 2,
    frozenTargetCount: 0,
    rejectedDiagnosticCount: 2,
    probeFailureCount: 0,
    firstFailure: {
      substage: "diagnostic-validate",
      code: "RUNTIME_GENERATED_DIAGNOSTIC_FIELDS_MISSING",
      targetTag: "table",
    },
  });
  expect(runtimeGeneratedDiagnosticsIssue([frozen.diagnostics]))
    .toBe("RUNTIME_GENERATED_DIAGNOSTICS_INCOMPLETE");
});

test("Runtime-generated discovery rejects stale diagnostics when Escape cannot clear them", HARNESS_TEST_OPTIONS, async ({ page }) => {
  await page.setContent(`
    <main
      data-runtime-root
      data-selection-runtime-generated="true"
      data-selection-runtime-generation="7"
      data-selection-runtime-source-anchor-id="${CORRECT_ID}"
      data-selection-runtime-kind="table"
      data-selection-runtime-path="table"
    >
      <section data-stemmio-id="${CORRECT_ID}">
        <table><tbody><tr><td>stale</td></tr></tbody></table>
      </section>
    </main>
  `);
  const frozen = await discoverRuntimeGeneratedTargets({
    page,
    frame: page,
    editor: page.locator("[data-runtime-root]"),
    tabId: "tab-a",
  });
  expect(frozen.targets).toEqual([]);
  expect(frozen.diagnostics.probeFailureCount).toBe(2);
  expect(frozen.diagnostics.firstFailure).toMatchObject({
    substage: "selection-clear",
    code: "RUNTIME_PROBE_SELECTION_NOT_CLEARED",
  });
  expect(runtimeGeneratedDiagnosticsIssue([frozen.diagnostics]))
    .toBe("RUNTIME_GENERATED_PROBE_FAILED");
  expect(runtimeGeneratedDiagnosticsIssue([]))
    .toBe("RUNTIME_GENERATED_DIAGNOSTICS_MISSING");
});

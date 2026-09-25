import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { loadedDiskFrame as loadedStaticDiskFrame } from "./helpers/stemmio-app-fixture.mjs";
import { readPublishedWorkingCopy } from "./helpers/working-copy-publication.mjs";
import {
  ProjectFileRepository,
  activateNativeEdit,
  caseSelector,
  setTextSelection,
  keyShortcut,
  closeStemmioGracefully,
  createSourceFixture,
  expectCheckpointPersisted,
  launchStemmio,
  loadedDiskFrame,
  mkdirSync,
  managedWorkingCopyPath,
  openRecentProject,
  path,
  readFileSync,
  realpathSync,
  renameSync,
  removeIsolatedUserData,
  removeSourceFixture,
  sha256,
  stopStemmio,
  waitForProjectReady,
} from "./electron-native-harness.mjs";

function identityPreservingCandidateHtml(target, title) {
  const current = readFileSync(target.exactSourcePath, "utf8");
  const candidate = current.replace(
    /(<title\b[^>]*>)[\s\S]*?(<\/title>)/iu,
    (_match, opening, closing) => `${opening}${title}${closing}`,
  );
  return candidate === current
    ? current.replace(/<\/html\s*>/iu, `<!-- ${title} --></html>`)
    : candidate;
}

function currentProjectTabName(filePath) {
  return `${path.basename(filePath, path.extname(filePath))} · 当前稿`;
}

test("sidebar toggle moves the Start tab without flashing it against the left edge", async () => {
  const fixture = createSourceFixture("sidebar-toggle-motion.html");
  const launched = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  try {
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    await launched.page.getByRole("button", { name: "新标签页" }).click();
    await expect(launched.page.locator('.workbench-tab[data-kind="start"]')).toBeVisible();
    await launched.page.emulateMedia({ reducedMotion: "no-preference" });

    const traceToggle = (opening) => launched.page.evaluate(async (shouldOpen) => {
      const workbench = document.querySelector(".workbench");
      const tablist = document.querySelector(".workbench-tablist");
      const startTab = () => document.querySelector('.workbench-tab[data-kind="start"]');
      const toggle = document.querySelector(".workbench-sidebar-toggle");
      if (!workbench || !tablist || !startTab() || !toggle) {
        throw new Error("Sidebar or Start tab is unavailable.");
      }
      const tabLeft = () => startTab()?.getBoundingClientRect().left ?? null;
      const positions = [tabLeft()];
      const togglePositions = [toggle.getBoundingClientRect().left];
      const dragRegionsOverToggle = () => {
        const rect = toggle.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        return [...document.querySelectorAll(
          ".workbench-tabbar, .workbench-tablist, .workbench-sidebar-titlebar, .workbench-sidebar-toggle-titlebar",
        )].filter((element) => {
          if (getComputedStyle(element).getPropertyValue("-webkit-app-region") !== "drag") return false;
          const region = element.getBoundingClientRect();
          return region.left <= x && x < region.right && region.top <= y && y < region.bottom;
        }).map((element) => element.className);
      };
      const dragOverlaps = [dragRegionsOverToggle()];
      let collecting = true;
      const sample = () => {
        if (!collecting) return;
        positions.push(tabLeft());
        togglePositions.push(document.querySelector(".workbench-sidebar-toggle")?.getBoundingClientRect().left ?? null);
        dragOverlaps.push(dragRegionsOverToggle());
        requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
      toggle.click();
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const animations = [...workbench.getAnimations(), ...tablist.getAnimations()];
      await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)));
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      collecting = false;
      positions.push(tabLeft());
      togglePositions.push(document.querySelector(".workbench-sidebar-toggle")?.getBoundingClientRect().left ?? null);
      dragOverlaps.push(dragRegionsOverToggle());
      return {
        positions,
        togglePositions,
        dragOverlaps,
        dragRegionCount: [...document.querySelectorAll(".workbench-tablist, .workbench-sidebar-titlebar")]
          .filter((element) => getComputedStyle(element).getPropertyValue("-webkit-app-region") === "drag").length,
        state: workbench.getAttribute("data-left-sidebar"),
        durations: [
          getComputedStyle(workbench).transitionDuration,
          getComputedStyle(tablist).transitionDuration,
        ],
        expectedState: shouldOpen ? "open" : "collapsed",
      };
    }, opening);

    const opening = await traceToggle(true);
    expect(opening.state).toBe(opening.expectedState);
    expect(opening.positions).not.toContain(null);
    expect(opening.positions.length).toBeGreaterThanOrEqual(3);
    expect(Math.min(...opening.positions), JSON.stringify(opening.positions))
      .toBeGreaterThanOrEqual(opening.positions[0] - 2);
    expect(opening.durations).toEqual(["0.12s", "0.12s"]);
    expect(Math.max(...opening.togglePositions) - Math.min(...opening.togglePositions))
      .toBeLessThanOrEqual(1);
    expect(opening.dragRegionCount).toBeGreaterThan(0);
    expect(opening.dragOverlaps).toEqual(opening.dragOverlaps.map(() => []));
    await launched.page.screenshot({
      path: test.info().outputPath("sidebar-open.png"),
      animations: "disabled",
    });

    const closing = await traceToggle(false);
    expect(closing.state).toBe(closing.expectedState);
    expect(closing.positions).not.toContain(null);
    expect(closing.positions.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...closing.positions), JSON.stringify(closing.positions))
      .toBeLessThanOrEqual(closing.positions[0] + 2);
    expect(closing.durations).toEqual(["0.12s", "0.12s"]);
    expect(Math.max(...closing.togglePositions) - Math.min(...closing.togglePositions))
      .toBeLessThanOrEqual(1);
    expect(closing.dragRegionCount).toBeGreaterThan(0);
    expect(closing.dragOverlaps).toEqual(closing.dragOverlaps.map(() => []));
    await launched.page.screenshot({
      path: test.info().outputPath("sidebar-collapsed.png"),
      animations: "disabled",
    });

    await launched.page.emulateMedia({ reducedMotion: "reduce" });
    const reducedDurations = await launched.page.evaluate(() => [
      getComputedStyle(document.querySelector(".workbench")).transitionDuration,
      getComputedStyle(document.querySelector(".workbench-tablist")).transitionDuration,
    ]);
    expect(reducedDurations).toEqual(["0s", "0s"]);
    await launched.page.getByRole("button", { name: "展开左侧边栏" }).click();
    await expect(launched.page.locator(".workbench")).toHaveAttribute("data-left-sidebar", "open");
    const stableToggle = launched.page.getByRole("button", { name: "收起左侧边栏" });
    await stableToggle.hover();
    await expect(launched.page.getByRole("tooltip")).toHaveText("收起左侧边栏");
    await stableToggle.click();
    await expect(launched.page.getByRole("button", { name: "展开左侧边栏" })).toBeVisible();
    await expect(launched.page.getByRole("tooltip")).toHaveText("展开左侧边栏");

    await launched.page.emulateMedia({ reducedMotion: "no-preference" });
    const appReducedDurations = await launched.page.evaluate(() => {
      const workbench = document.querySelector(".workbench");
      workbench.setAttribute("data-motion", "reduced");
      const durations = [
        getComputedStyle(workbench).transitionDuration,
        getComputedStyle(document.querySelector(".workbench-tablist")).transitionDuration,
      ];
      workbench.setAttribute("data-motion", "system");
      return durations;
    });
    expect(appReducedDurations[0]).toBe("0s");
    expect(Number.parseFloat(appReducedDurations[1])).toBeLessThan(0.001);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron switches current drafts through the real Canvas", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("direct-canvas-a.html");
  const projectB = createSourceFixture("direct-canvas-b.html");
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
  });
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await openRecentProject(launched.page, projectB.sourcePath);
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    await tabs.filter({ hasText: "direct-canvas-a" }).click();
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await tabs.filter({ hasText: "direct-canvas-b" }).click();
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    await expect(launched.page.getByTestId("html-canvas-editor")).toHaveCount(1);
    const geometry = await launched.page.evaluate(() => ({
      canvas: document.querySelector(".review-scroll-stage .canvas-column")?.getBoundingClientRect().width || 0,
      rail: document.querySelector(".review-scroll-stage .comments-panel.comment-rail")?.getBoundingClientRect().width || 0,
    }));
    expect(geometry.canvas).toBeGreaterThan(0);
    expect(geometry.rail).toBeGreaterThan(0);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("Electron leaves the outgoing draft inert until the new Canvas can be displayed", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("live-handoff-a.html");
  const projectB = createSourceFixture("live-handoff-b.html");
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
  });
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await openRecentProject(launched.page, projectB.sourcePath);
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    const canvas = launched.page.locator(".canvas-edit-surface");
    const captureCanvasViewport = async (path = undefined) => {
      const box = await canvas.boundingBox();
      if (!box) throw new Error("Canvas viewport is unavailable");
      return launched.page.screenshot({
        ...(path ? { path } : {}),
        clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 600) },
      });
    };
    const before = await captureCanvasViewport();
    await holdCanvasLoads(launched.page);
    const tabA = launched.page.getByRole("tablist", { name: "已打开的页面" })
      .getByRole("tab").filter({ hasText: "live-handoff-a" });
    await tabA.dispatchEvent("click");
    const outgoing = launched.page.locator("[data-outgoing-draft]");
    await expect(outgoing).toBeVisible();
    await expect(outgoing).toHaveAttribute("inert", "");
    const openingTab = launched.page.locator('.workbench-tab[data-selected="true"][data-opening="true"]');
    await expect(openingTab).toBeVisible();
    expect(await openingTab.evaluate((element) => (
      getComputedStyle(element, "::after").backgroundColor
    ))).toBe("rgb(90, 85, 223)");
    await expect(launched.page.locator("[data-handoff-candidate='true']"))
      .toHaveCSS("opacity", "0");
    await expect(launched.page.locator("[data-handoff-candidate='true']"))
      .toHaveCSS("visibility", "visible");
    await expect(launched.page.getByRole("button", { name: "预览", exact: true }))
      .toBeEnabled();
    await expect.poll(() => launched.page.evaluate(() => Boolean(
      window.__STEMMIO_TEST_DELAYED_CANVAS_FRAME__,
    ))).toBe(true);
    const held = await captureCanvasViewport(test.info().outputPath("outgoing-draft-held.png"));
    const first = await sharp(before).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const second = await sharp(held).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    expect(second.info.width).toBe(first.info.width);
    expect(second.info.height).toBe(first.info.height);
    let changedPixels = 0;
    for (let offset = 0; offset < first.data.length; offset += 3) {
      if (Math.max(...[0, 1, 2].map((channel) => Math.abs(
        first.data[offset + channel] - second.data[offset + channel],
      ))) > 12) changedPixels += 1;
    }
    expect(changedPixels / (first.info.width * first.info.height)).toBeLessThan(0.01);
    await launched.page.evaluate(() => {
      const onLoad = window.__STEMMIO_TEST_DELAYED_CANVAS_ON_LOAD__;
      const frame = window.__STEMMIO_TEST_DELAYED_CANVAS_FRAME__;
      if (typeof onLoad !== "function" || !(frame instanceof HTMLIFrameElement)) {
        throw new Error("Destination Canvas load callback was unavailable");
      }
      window.__STEMMIO_TEST_BLOCK_CANVAS_LOAD__ = false;
      onLoad({ currentTarget: frame });
    });
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await expect(outgoing).toHaveCount(0);
    await expect(launched.page.getByTestId("html-canvas-editor")).toHaveCount(1);
    await expect(launched.page.getByRole("button", { name: "预览", exact: true }))
      .toBeEnabled();
  } finally {
    await releaseCanvasLoadHold(launched.page);
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("Electron keeps scripted tab and mode transitions on their finished frame", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("runtime-handoff-static.html");
  const projectB = createSourceFixture("runtime-handoff-scripted.html", (html) => (
    html.replace("</body>", `<script>
      const chart = document.createElement("div");
      chart.id = "scripted-tab-chart";
      chart.textContent = "图表已显示";
      document.body.append(chart);
    </script></body>`)
  ));
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
  });
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await openRecentProject(launched.page, projectB.sourcePath);
    await expect(launched.page.locator(".canvas-edit-surface"))
      .toHaveAttribute("data-edit-runtime-phase", "settled");
    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    await tabs.filter({ hasText: "runtime-handoff-static" }).click();
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    const outgoingSize = await launched.page.locator('[data-runtime-hot-active="true"]')
      .evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      });
    await launched.electronApp.evaluate(() => {
      globalThis.__stemmioE2eHoldEditRuntimePrepare();
    });
    await tabs.filter({ hasText: "runtime-handoff-scripted" }).click();
    await expect(launched.page.locator(".canvas-edit-surface"))
      .toHaveAttribute("data-edit-runtime-phase", "preparing");
    await expect(launched.page.locator('[data-handoff-candidate="true"] [data-render-verified="true"]'))
      .toHaveCount(1);
    const activeCanvasForBenchmark = launched.page.getByTestId("workbench-active-document-canvas-host")
      .locator('[data-runtime-hot-active="true"]')
      .getByTestId("html-canvas-editor");
    await expect(activeCanvasForBenchmark).toHaveCount(0);
    const outgoing = launched.page.locator("[data-outgoing-draft]");
    await expect(outgoing).toBeVisible();
    await expect(outgoing).toHaveAttribute("inert", "");
    expect(await outgoing.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    })).toEqual(outgoingSize);
    await expect(launched.page.locator('[data-handoff-candidate="true"]'))
      .toHaveCSS("opacity", "0");
    await expect(launched.page.locator('[data-handoff-candidate="true"]'))
      .toHaveCSS("visibility", "visible");
    await expect(launched.page.locator('.workbench-tab[data-selected="true"][data-opening="true"]'))
      .toBeVisible();
    await expect(tabs.filter({ hasText: "runtime-handoff-static" }).locator("xpath=.."))
      .not.toHaveAttribute("data-selected", "true");
    await expect(tabs.filter({ hasText: "runtime-handoff-scripted" }).locator("xpath=.."))
      .toHaveAttribute("data-selected", "true");
    await launched.electronApp.evaluate(() => {
      globalThis.__stemmioE2eReleaseEditRuntimePrepare();
    });
    await expect(launched.page.locator(".canvas-edit-surface"))
      .toHaveAttribute("data-edit-runtime-phase", "settled");
    await expect(outgoing).toHaveCount(0);
    await expect(activeCanvasForBenchmark).toHaveAttribute("data-render-verified", "true");
    await expect(launched.page.locator('.workbench-tab[data-selected="true"][data-opening="true"]'))
      .toHaveCount(0);
    await expect(launched.page.frameLocator('iframe[data-runtime-slot-role="active"]')
      .locator("#scripted-tab-chart")).toHaveText("图表已显示");
    await expect.poll(() => launched.page.evaluate(() => performance.getEntriesByName(
      "stemmio:edit-canvas:outgoing-release", "mark",
    ).length)).toBeGreaterThan(0);
    const runtimeMarks = await launched.page.evaluate(() => performance.getEntriesByType("mark")
      .filter((entry) => /^(stemmio:edit-canvas:|stemmio:edit-runtime:)/u.test(entry.name))
      .map((entry) => ({ name: entry.name, detail: entry.detail })));
    for (const name of [
      "stemmio:edit-canvas:iframe-create",
      "stemmio:edit-canvas:candidate-create",
      "stemmio:edit-runtime:prepare-start",
      "stemmio:edit-runtime:prepare-result",
      "stemmio:edit-runtime:execute-start",
      "stemmio:edit-runtime:execute-result",
      "stemmio:edit-runtime:author-scripts",
      "stemmio:edit-canvas:display-handoff",
      "stemmio:edit-canvas:outgoing-release",
    ]) expect(runtimeMarks.some((mark) => mark.name === name)).toBe(true);
    expect(runtimeMarks.some((mark) => mark.name === "stemmio:edit-runtime:author-scripts"
      && mark.detail?.attemptedScriptCount === 1)).toBe(true);
    const authored = runtimeMarks.filter((mark) => mark.name === "stemmio:edit-runtime:author-scripts"
      && mark.detail?.attemptedScriptCount === 1).at(-1);
    expect(authored?.detail?.activationId).toBeTruthy();
    expect(authored?.detail?.runtimeSessionId).toBeTruthy();
    expect(runtimeMarks.some((mark) => mark.name === "stemmio:edit-canvas:iframe-create"
      && mark.detail?.activationId === authored.detail.activationId)).toBe(true);
    expect(runtimeMarks.some((mark) => mark.name === "stemmio:edit-canvas:candidate-create"
      && mark.detail?.activationId === authored.detail.activationId
      && mark.detail?.attemptId === authored.detail.attemptId)).toBe(true);
    expect(runtimeMarks.some((mark) => mark.name === "stemmio:edit-runtime:prepare-result"
      && mark.detail?.runtimeSessionId === authored.detail.runtimeSessionId)).toBe(true);
    expect(runtimeMarks.some((mark) => mark.name === "stemmio:edit-runtime:execute-result"
      && mark.detail?.runtimeSessionId === authored.detail.runtimeSessionId
      && mark.detail?.attemptId === authored.detail.attemptId)).toBe(true);
    expect(runtimeMarks.some((mark) => mark.name === "stemmio:edit-canvas:outgoing-release"
      && mark.detail?.activationId === authored.detail.activationId)).toBe(true);
    expect(runtimeMarks.every((mark) => !Object.keys(mark.detail || {})
      .some((key) => /html|sourcePath|absolutePath/iu.test(key)))).toBe(true);
    const editSize = await launched.page.locator(".canvas-edit-surface").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      window.__STEMMIO_TEST_SCRIPTED_EDIT_FRAME__ = element.querySelector(
        'iframe[data-runtime-slot-role="active"]',
      );
      return { width: bounds.width, height: bounds.height };
    });
    await launched.page.getByRole("group", { name: "工作模式" })
      .getByRole("button", { name: "预览" }).click();
    await expect(launched.page.getByTestId("workbench-active-preview"))
      .toHaveAttribute("data-preview-ready", "true");
    await expect(launched.page.locator(".canvas-edit-surface"))
      .toHaveAttribute("data-preview-underlay", "true");
    const previewSize = await launched.page.locator(".canvas-edit-surface").evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { width: bounds.width, height: bounds.height };
    });
    expect(previewSize).toEqual(editSize);
    await launched.page.getByRole("group", { name: "工作模式" })
      .getByRole("button", { name: "编辑" }).click();
    await expect(launched.page.locator(".canvas-edit-surface"))
      .not.toHaveAttribute("data-preview-underlay", "true");
    expect(await launched.page.evaluate(() => (
      document.querySelector('.canvas-edit-surface iframe[data-runtime-slot-role="active"]')
      === window.__STEMMIO_TEST_SCRIPTED_EDIT_FRAME__
    ))).toBe(true);

    // A document Preview may be ready while its Edit runtime is still cold.
    // Returning to Edit must keep that document's Preview in front instead of
    // resurrecting the prior tab's Edit iframe.
    await launched.page.getByRole("group", { name: "工作模式" })
      .getByRole("button", { name: "预览" }).click();
    await expect(launched.page.getByTestId("workbench-active-preview"))
      .toHaveAttribute("data-preview-ready", "true");
    await tabs.filter({ hasText: "runtime-handoff-static" }).click();
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await launched.electronApp.evaluate(() => {
      globalThis.__stemmioE2eHoldEditRuntimePrepare();
    });
    await tabs.filter({ hasText: "runtime-handoff-scripted" }).click();
    await expect(launched.page.getByTestId("workbench-active-preview"))
      .toHaveAttribute("data-preview-ready", "true");
    await expect(launched.page.locator('.workbench-tab[data-selected="true"][data-opening="true"]'))
      .toHaveCount(0);
    await expect(launched.page.locator("[data-outgoing-draft]")).toHaveCount(0);
    const previewCarrySize = await launched.page.getByTestId("workbench-active-preview")
      .evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      });
    const editHandoffsBeforeCarry = await launched.page.evaluate(() => performance.getEntriesByName(
      "stemmio:edit-canvas:display-handoff", "mark",
    ).length);
    await launched.page.getByRole("group", { name: "工作模式" })
      .getByRole("button", { name: "编辑" }).click();
    await expect(launched.page.getByTestId("workbench-active-preview"))
      .toHaveAttribute("data-preview-carry", "true");
    expect(await launched.page.evaluate(() => performance.getEntriesByName(
      "stemmio:edit-canvas:display-handoff", "mark",
    ).length)).toBe(editHandoffsBeforeCarry);
    expect(await launched.page.getByTestId("workbench-active-preview")
      .evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        return { width: bounds.width, height: bounds.height };
      })).toEqual(previewCarrySize);
    await expect(launched.page.locator("[data-outgoing-draft]")).toHaveCount(0);
    await launched.electronApp.evaluate(() => {
      globalThis.__stemmioE2eReleaseEditRuntimePrepare();
    });
    await expect(launched.page.locator(".canvas-edit-surface"))
      .toHaveAttribute("data-edit-runtime-phase", "settled");
    await expect(launched.page.getByTestId("workbench-active-preview"))
      .toHaveCount(0);
    await expect.poll(() => launched.page.evaluate(() => performance.getEntriesByName(
      "stemmio:edit-canvas:display-handoff", "mark",
    ).length)).toBe(editHandoffsBeforeCarry + 1);
  } finally {
    await launched.electronApp.evaluate(() => {
      globalThis.__stemmioE2eReleaseEditRuntimePrepare();
    }).catch(() => {});
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("Electron keeps the verified canvas during a rapid return to its tab", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("rapid-return-a.html");
  const projectB = createSourceFixture("rapid-return-b.html");
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
  });
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await openRecentProject(launched.page, projectB.sourcePath);
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    const tabA = tabs.filter({ hasText: "rapid-return-a" });
    const tabB = tabs.filter({ hasText: "rapid-return-b" });
    await tabA.click();
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await holdCanvasLoads(launched.page);

    await tabB.dispatchEvent("click");
    const outgoing = launched.page.locator("[data-outgoing-draft]");
    await expect(outgoing).toBeVisible();
    await expect(outgoing).toHaveAttribute("inert", "");
    await expect(launched.page.locator("[data-handoff-candidate='true']"))
      .toHaveCSS("opacity", "0");

    await tabA.dispatchEvent("click");
    await expect(tabA).toHaveAttribute("aria-selected", "true");
    await expect(outgoing).toBeVisible();
    await expect(outgoing).toHaveAttribute("inert", "");
    await expect(launched.page.locator("[data-handoff-candidate='true']"))
      .toHaveCSS("opacity", "0");
    await expect(launched.page.locator("[data-handoff-candidate='true']"))
      .toHaveAttribute("inert", "");
    await expect(launched.page.getByRole("button", { name: "预览", exact: true }))
      .toBeEnabled();

    await expect.poll(() => launched.page.evaluate(() => Boolean(
      window.__STEMMIO_TEST_DELAYED_CANVAS_FRAME__,
    ))).toBe(true);
    await launched.page.evaluate(() => {
      const onLoad = window.__STEMMIO_TEST_DELAYED_CANVAS_ON_LOAD__;
      const frame = window.__STEMMIO_TEST_DELAYED_CANVAS_FRAME__;
      if (typeof onLoad !== "function" || !(frame instanceof HTMLIFrameElement)) {
        throw new Error("Returned Canvas load callback was unavailable");
      }
      window.__STEMMIO_TEST_BLOCK_CANVAS_LOAD__ = false;
      onLoad({ currentTarget: frame });
    });
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await expect(outgoing).toHaveCount(0);
    await expect(launched.page.getByTestId("html-canvas-editor")).toHaveCount(1);
  } finally {
    await releaseCanvasLoadHold(launched.page);
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("Electron Preview opens the selected draft while unrelated Canvas work continues", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("preview-ready-a.html", (html) => (
    html.replace("列表项中的文字保持项目符号和缩进。", "预览目标 A")
  ));
  const projectB = createSourceFixture("preview-ready-b.html");
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
  });
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await openRecentProject(launched.page, projectB.sourcePath);
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    await holdCanvasLoads(launched.page);
    await launched.page.getByRole("tablist", { name: "已打开的页面" })
      .getByRole("tab").filter({ hasText: "preview-ready-a" }).dispatchEvent("click");
    await expect(launched.page.locator("[data-outgoing-draft]")).toBeVisible();
    const previewButton = launched.page.getByRole("button", { name: "预览", exact: true });
    await expect(previewButton).toBeEnabled();
    await previewButton.click();
    await expect(previewButton).toHaveAttribute("aria-pressed", "true");
    await expect(launched.page.frameLocator('iframe[title="HTML 交互预览"]')
      .getByText("预览目标 A")).toBeVisible();
    await expect(launched.page.locator("[data-outgoing-draft]")).toHaveCount(0);
  } finally {
    await releaseCanvasLoadHold(launched.page);
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("Electron keeps a verified page visible while Preview loads and across Preview tabs", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("preview-handoff-a.html", (html) => (
    html.replace("列表项中的文字保持项目符号和缩进。", "预览交接目标 A")
      .replace("</body>", '<img src="https://stemmio-handoff.invalid/slow-a.png"></body>')
  ));
  const projectB = createSourceFixture("preview-handoff-b.html", (html) => (
    html.replace("列表项中的文字保持项目符号和缩进。", "预览交接目标 B")
      .replace("</body>", '<img src="https://stemmio-handoff.invalid/slow-b.png"></body>')
  ));
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
  });
  let blockedRoutes = [];
  let blocking = true;
  let blockedImage = "slow-a.png";
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await openRecentProject(launched.page, projectB.sourcePath);
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    const mode = launched.page.getByRole("group", { name: "工作模式", exact: true });
    await mode.getByRole("button", { name: "预览", exact: true }).click();
    await expect(launched.page.frameLocator('iframe[title="HTML 交互预览"]')
      .getByText("预览交接目标 B")).toBeVisible();
    await launched.page.getByRole("tablist", { name: "已打开的页面" })
      .getByRole("tab").filter({ hasText: "preview-handoff-a" }).click();
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");

    await launched.page.route("https://stemmio-handoff.invalid/slow-*.png", async (route) => {
      if (!blocking || !route.request().url().endsWith(blockedImage)) return route.continue();
      blockedRoutes.push(route);
      await new Promise((resolve) => { route.release = resolve; });
      await route.continue();
    });
    await mode.getByRole("button", { name: "预览", exact: true }).click();
    await expect.poll(() => blockedRoutes.length > 0).toBe(true);
    const previewHost = launched.page.getByTestId("workbench-active-preview");
    await expect(previewHost).toHaveAttribute("data-preview-ready", "false");
    await expect(mode.getByRole("button", { name: "预览", exact: true }))
      .toHaveAttribute("aria-busy", "true");
    await expect(mode.getByRole("button", { name: "预览", exact: true }))
      .toHaveAttribute("data-preview-opening", "true");
    await expect(previewHost.getByText("正在打开预览…")).toHaveCount(0);
    await expect(launched.page.locator(".canvas-edit-surface")).toBeVisible();
    await expect(launched.page.locator(".canvas-edit-surface")).toHaveAttribute("inert", "");
    await expect(launched.page.frameLocator('iframe[title="HTML 可视化编辑画布"]')
      .getByText("预览交接目标 A")).toBeVisible();
    await mode.getByRole("button", { name: "编辑", exact: true }).click();
    await expect(mode.getByRole("button", { name: "编辑", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => launched.page.evaluate(() => performance.getEntriesByName(
      "stemmio:preview:display-result", "mark",
    ).some((entry) => entry.detail?.status === "cancelled"))).toBe(true);
    blocking = false;
    blockedRoutes.splice(0).forEach((route) => route.release());
    await mode.getByRole("button", { name: "预览", exact: true }).click();
    await expect(previewHost).toHaveAttribute("data-preview-ready", "true");
    await expect(mode.getByRole("button", { name: "预览", exact: true }))
      .not.toHaveAttribute("aria-busy", "true");
    await expect(previewHost).toHaveAttribute("data-preview-outcome", "verified");
    await expect(launched.page.frameLocator('iframe[title="HTML 交互预览"]')
      .getByText("预览交接目标 A")).toBeVisible();

    blocking = true;
    blockedImage = "slow-b.png";
    await launched.page.getByRole("tablist", { name: "已打开的页面" })
      .getByRole("tab").filter({ hasText: "preview-handoff-b" }).click();
    await expect.poll(() => blockedRoutes.length > 0).toBe(true);
    await expect(previewHost).toHaveAttribute("data-outgoing-preview", "true");
    await expect(previewHost.locator(':scope > [inert]:not([data-handoff-candidate]) iframe[title="HTML 交互预览"]'))
      .toBeVisible();
    await expect(previewHost.locator(':scope > [inert]:not([data-handoff-candidate]) iframe[title="HTML 交互预览"]')
      .contentFrame().getByText("预览交接目标 A")).toBeVisible();
    blocking = false;
    blockedRoutes.splice(0).forEach((route) => route.release());
    await expect(previewHost).toHaveAttribute("data-preview-ready", "true");
    await expect(launched.page.frameLocator('iframe[title="HTML 交互预览"]')
      .getByText("预览交接目标 B")).toBeVisible();
    await mode.getByRole("button", { name: "编辑", exact: true }).click();
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    blocking = true;
    await mode.getByRole("button", { name: "预览", exact: true }).click();
    await expect.poll(() => blockedRoutes.length > 0).toBe(true);
    await expect(previewHost).toHaveAttribute("data-preview-ready", "false");
    await expect(launched.page.locator(".canvas-edit-surface")).toBeVisible();
    await expect(launched.page.locator(".canvas-edit-surface")).toHaveAttribute("inert", "");
    await expect(launched.page.frameLocator('iframe[title="HTML 可视化编辑画布"]')
      .getByText("预览交接目标 B")).toBeVisible();
    blocking = false;
    blockedRoutes.splice(0).forEach((route) => route.release());
    await expect(previewHost).toHaveAttribute("data-preview-ready", "true");
    await expect(launched.page.frameLocator('iframe[title="HTML 交互预览"]')
      .getByText("预览交接目标 B")).toBeVisible();
  } finally {
    blockedRoutes.splice(0).forEach((route) => route.release());
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("Electron retains the actual surface when a mode handoff is interrupted by another tab", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("interrupted-mode-a.html", (html) => (
    html.replace("列表项中的文字保持项目符号和缩进。", "中断交接画面 A")
      .replace("</body>", '<img src="https://stemmio-handoff.invalid/interrupted-a.png"></body>')
  ));
  const projectB = createSourceFixture("interrupted-mode-b.html", (html) => (
    html.replace("列表项中的文字保持项目符号和缩进。", "中断交接画面 B")
      .replace("</body>", "<script>document.body.dataset.interruptedRuntime = 'ready';</script></body>")
  ));
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
  });
  const heldWorkspace = [];
  const heldImages = [];
  let blockedTarget = null;
  try {
    const page = launched.page;
    await loadedDiskFrame(page, projectA.sourcePath, "list-item");
    await openRecentProject(page, projectB.sourcePath);
    await loadedDiskFrame(page, projectB.sourcePath, "list-item");
    const mode = page.getByRole("group", { name: "工作模式", exact: true });
    const tabs = page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    const tabA = tabs.filter({ hasText: "interrupted-mode-a" });
    const tabB = tabs.filter({ hasText: "interrupted-mode-b" });
    await mode.getByRole("button", { name: "预览", exact: true }).click();
    await expect(page.getByTestId("workbench-active-preview"))
      .toHaveAttribute("data-preview-ready", "true");
    await tabA.click();
    await loadedDiskFrame(page, projectA.sourcePath, "list-item");

    await page.route("**/workspace?*", async (route) => {
      const source = new URL(route.request().url()).searchParams.get("sourcePath");
      if (!blockedTarget || !source || path.basename(source) !== path.basename(blockedTarget)) {
        await route.continue();
        return;
      }
      heldWorkspace.push(route);
      await new Promise((resolve) => { route.release = resolve; });
      await route.continue();
    });
    await launched.electronApp.evaluate(() => {
      globalThis.__stemmioE2eHoldEditRuntimePrepare();
    });
    await tabB.click();
    await expect(page.getByTestId("workbench-active-preview"))
      .toHaveAttribute("data-preview-ready", "true");
    await mode.getByRole("button", { name: "编辑", exact: true }).click();
    const previewHost = page.getByTestId("workbench-active-preview");
    await expect(previewHost).toHaveAttribute("data-preview-carry", "true");
    blockedTarget = projectA.sourcePath;
    await tabA.click();
    await expect.poll(() => heldWorkspace.length).toBeGreaterThan(0);
    await expect(previewHost).toBeVisible();
    await expect(previewHost).toHaveAttribute("data-display-handoff-role", "outgoing");
    await expect(previewHost.locator(':scope > [inert] iframe[title="HTML 交互预览"]')
      .contentFrame().getByText("中断交接画面 B")).toBeVisible();
    blockedTarget = null;
    heldWorkspace.splice(0).forEach((route) => route.release());
    await launched.electronApp.evaluate(() => {
      globalThis.__stemmioE2eReleaseEditRuntimePrepare();
    });
    await loadedDiskFrame(page, projectA.sourcePath, "list-item");

    await page.route("https://stemmio-handoff.invalid/interrupted-a.png", async (route) => {
      heldImages.push(route);
      await new Promise((resolve) => { route.release = resolve; });
      await route.continue();
    });
    await mode.getByRole("button", { name: "预览", exact: true }).click();
    await expect.poll(() => heldImages.length).toBeGreaterThan(0);
    await expect(previewHost).toHaveAttribute("data-preview-ready", "false");
    blockedTarget = projectB.sourcePath;
    await tabB.click();
    await expect.poll(() => heldWorkspace.length).toBeGreaterThan(0);
    await expect(page.locator(".canvas-edit-surface")).toBeVisible();
    await expect(page.locator(".canvas-edit-surface")).toHaveAttribute("inert", "");
    await expect(page.locator('[data-outgoing-draft] iframe[title^="HTML 可视化编辑画布"]')
      .contentFrame()
      .getByText("中断交接画面 A")).toBeVisible();
    blockedTarget = null;
    heldWorkspace.splice(0).forEach((route) => route.release());
    heldImages.splice(0).forEach((route) => route.release());
    await loadedDiskFrame(page, projectB.sourcePath, "list-item");
  } finally {
    blockedTarget = null;
    heldWorkspace.splice(0).forEach((route) => route.release());
    heldImages.splice(0).forEach((route) => route.release());
    await launched.electronApp.evaluate(() => {
      globalThis.__stemmioE2eReleaseEditRuntimePrepare();
    }).catch(() => {});
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("a failed Preview target releases the prior page and a fresh retry loads the target", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  const projectA = createSourceFixture("preview-failure-a.html", (html) => (
    html.replace("列表项中的文字保持项目符号和缩进。", "失败前页面 A")
  ));
  const projectB = createSourceFixture("preview-failure-b.html", (html) => (
    html.replace("列表项中的文字保持项目符号和缩进。", "重试目标页面 B")
  ));
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
  });
  try {
    const page = launched.page;
    await loadedDiskFrame(page, projectA.sourcePath, "list-item");
    await openRecentProject(page, projectB.sourcePath);
    await loadedDiskFrame(page, projectB.sourcePath, "list-item");
    const tabs = page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    const tabA = tabs.filter({ hasText: "preview-failure-a" });
    const tabB = tabs.filter({ hasText: "preview-failure-b" });
    const mode = page.getByRole("group", { name: "工作模式" });
    const previewHost = page.getByTestId("workbench-active-preview");
    await mode.getByRole("button", { name: "预览", exact: true }).click();
    await expect(previewHost).toHaveAttribute("data-preview-ready", "true");
    await tabA.click();
    await loadedDiskFrame(page, projectA.sourcePath, "list-item");
    await mode.getByRole("button", { name: "预览", exact: true }).click();
    await expect(previewHost).toHaveAttribute("data-preview-ready", "true");
    await expect(page.frameLocator('iframe[title="HTML 交互预览"]')
      .getByText("失败前页面 A")).toBeVisible();

    await launched.electronApp.evaluate(({ ipcMain }) => {
      const channel = "html-preview:create-session";
      const original = ipcMain._invokeHandlers?.get(channel);
      if (typeof original !== "function") throw new Error("Preview IPC handler unavailable");
      let failNext = true;
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, (event, payload) => {
        if (failNext) {
          failNext = false;
          throw new Error("synthetic Preview creation failure");
        }
        return original(event, payload);
      });
    });
    await tabB.click();
    await expect(previewHost.getByRole("status")).toContainText("预览暂时无法显示");
    await expect(previewHost).toHaveAttribute("data-preview-ready", "false");
    await expect(previewHost).toHaveAttribute("data-preview-outcome", "failed");
    await expect(previewHost).not.toHaveAttribute("data-outgoing-preview", "true");
    await expect(previewHost.frameLocator('iframe[title="HTML 交互预览"]')
      .getByText("失败前页面 A")).toHaveCount(0);
    await expect(page.locator('.workbench-tab[data-selected="true"]'))
      .not.toHaveAttribute("data-opening", "true");
    await previewHost.getByRole("button", { name: "重试打开" }).click();
    await expect(previewHost).toHaveAttribute("data-preview-ready", "true");
    await expect(previewHost).toHaveAttribute("data-preview-outcome", "verified");
    await expect(page.frameLocator('iframe[title="HTML 交互预览"]')
      .getByText("重试目标页面 B")).toBeVisible();
    await expect(previewHost.getByRole("status")).toHaveCount(0);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("a failed historical Preview keeps its static fallback visible", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle", "@smoke-version-display"],
}, async () => {
  const fixture = createSourceFixture("history-preview-static-fallback.html");
  const launched = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  try {
    const page = launched.page;
    await loadedDiskFrame(page, fixture.sourcePath, "list-item");
    await waitForProjectReady(page);
    await launched.electronApp.evaluate(({ ipcMain }) => {
      const channel = "html-preview:create-session";
      const original = ipcMain._invokeHandlers?.get(channel);
      if (typeof original !== "function") throw new Error("Preview IPC handler unavailable");
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => {
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, original);
        throw new Error("synthetic historical Preview creation failure");
      });
    });
    await page.getByRole("button", { name: "展开左侧边栏" }).click();
    const project = page.locator(".sidebar-project-item")
      .filter({ hasText: "history-preview-static-fallback" }).first();
    if (await project.locator(".sidebar-project-row").getAttribute("aria-expanded") !== "true") {
      await project.locator(".sidebar-project-row").click();
    }
    if (await project.locator(".sidebar-project-history-toggle").getAttribute("aria-expanded") !== "true") {
      await project.locator(".sidebar-project-history-toggle").click();
    }
    await project.getByRole("button", { name: "V1，历史版本", exact: true }).click();

    const host = page.getByTestId("workbench-active-preview");
    const fallback = page.getByTestId("html-interaction-preview");
    await expect(host).toHaveAttribute("data-preview-ready", "true");
    await expect(host).toHaveAttribute("data-preview-outcome", "degraded");
    await expect(host).toHaveAttribute("data-preview-degradation", "history-static");
    await expect(fallback.getByRole("status"))
      .toContainText("正在显示只读静态内容");
    await expect(host.frameLocator('iframe[title="HTML 交互预览"]')
      .locator(caseSelector("list-item"))).toBeVisible();
    await page.waitForTimeout(150);
    await expect(fallback.getByRole("status"))
      .toContainText("正在显示只读静态内容");
    await expect(host.frameLocator('iframe[title="HTML 交互预览"]')
      .locator(caseSelector("list-item"))).toBeVisible();
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron stages a saved Preview mode before the tab page is revealed", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("preview-order-edit.html");
  const projectB = createSourceFixture("preview-order-preview.html", (html) => (
    html.replace("</body>", '<img src="https://stemmio-handoff.invalid/preview-order.png"></body>')
  ));
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
  });
  const blockedRoutes = [];
  let blocking = false;
  try {
    const page = launched.page;
    await loadedDiskFrame(page, projectA.sourcePath, "list-item");
    await openRecentProject(page, projectB.sourcePath);
    await loadedDiskFrame(page, projectB.sourcePath, "list-item");
    const mode = page.getByRole("group", { name: "工作模式", exact: true });
    const previewButton = mode.getByRole("button", { name: "预览", exact: true });
    await previewButton.click();
    await expect(page.getByTestId("workbench-active-preview"))
      .toHaveAttribute("data-preview-ready", "true");
    const tabs = page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    await tabs.filter({ hasText: "preview-order-edit" }).click();
    await loadedDiskFrame(page, projectA.sourcePath, "list-item");
    await expect(mode.getByRole("button", { name: "编辑", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await page.route("https://stemmio-handoff.invalid/preview-order.png", async (route) => {
      if (!blocking) return route.continue();
      blockedRoutes.push(route);
      await new Promise((resolve) => { route.release = resolve; });
      await route.continue();
    });
    blocking = true;
    await page.evaluate(() => {
      window.__previewOrderFrames = [];
      let previous = "";
      const sample = () => {
        const button = document.querySelector('.canvas-mode-switch button:nth-child(2)');
        const preview = document.querySelector('[data-testid="workbench-active-preview"]');
        const state = {
          selected: button?.getAttribute("aria-pressed") === "true",
          spinning: button?.getAttribute("data-preview-opening") === "true",
          ready: preview?.getAttribute("data-preview-ready") === "true",
        };
        const fingerprint = JSON.stringify(state);
        if (fingerprint !== previous) {
          window.__previewOrderFrames.push(state);
          previous = fingerprint;
        }
        window.__previewOrderRaf = requestAnimationFrame(sample);
      };
      sample();
    });
    await tabs.filter({ hasText: "preview-order-preview" }).click();
    await expect.poll(() => blockedRoutes.length).toBeGreaterThan(0);
    const selectedTab = page.locator('.workbench-tab[data-selected="true"][data-opening="true"]');
    await expect(selectedTab).toBeVisible();
    await expect(previewButton).toHaveAttribute("aria-pressed", "true");
    await expect(previewButton).toHaveAttribute("aria-busy", "true");
    await expect(page.getByTestId("workbench-active-preview"))
      .toHaveAttribute("data-preview-ready", "false");
    await expect(page.getByText("正在打开预览…")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("preview-opening-order.png") });
    blocking = false;
    blockedRoutes.splice(0).forEach((route) => route.release());
    await expect(page.getByTestId("workbench-active-preview"))
      .toHaveAttribute("data-preview-ready", "true");
    await expect(selectedTab).toHaveCount(0);
    await expect(previewButton).not.toHaveAttribute("aria-busy", "true");
    const frames = await page.evaluate(() => {
      cancelAnimationFrame(window.__previewOrderRaf);
      return window.__previewOrderFrames;
    });
    const selectedAt = frames.findIndex((state) => state.selected && !state.spinning);
    const spinningAt = frames.findIndex((state) => state.spinning && !state.ready);
    const readyAt = frames.findIndex((state) => state.ready);
    expect(selectedAt).toBeGreaterThanOrEqual(0);
    expect(spinningAt).toBeGreaterThan(selectedAt);
    expect(readyAt).toBeGreaterThan(spinningAt);
  } finally {
    blocking = false;
    blockedRoutes.splice(0).forEach((route) => route.release());
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("Electron waits for Preview paint evidence or its bounded fallback", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  const fixture = createSourceFixture("preview-paint-gate.html", () => `<!DOCTYPE html>
    <html><head><meta charset="utf-8"><title>Preview paint gate</title></head>
    <body><script>
      window.addEventListener("message", (event) => {
        if (event.data?.type === "stemmio-preview-visual-ready-request") {
          window.parent.postMessage({ type: "synthetic-visual-request-observed" }, "*");
        }
      });
    </script></body></html>`);
  const launched = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  try {
    const page = launched.page;
    await expect(page.getByTestId("html-canvas-editor"))
      .toHaveAttribute("data-render-verified", "true");
    await page.evaluate(() => {
      window.__syntheticVisualRequestObserved = false;
      window.addEventListener("message", (event) => {
        if (event.data?.type === "synthetic-visual-request-observed") {
          window.__syntheticVisualRequestObserved = true;
        }
      });
    });
    await page.getByRole("group", { name: "工作模式" })
      .getByRole("button", { name: "预览" }).click();
    await expect.poll(() => page.evaluate(() => window.__syntheticVisualRequestObserved))
      .toBe(true);
    const preview = page.getByTestId("workbench-active-preview");
    await expect(preview).toHaveAttribute("data-preview-ready", "false");
    await page.frameLocator('iframe[title="HTML 交互预览"]').locator("body")
      .evaluate((body) => {
        const heading = document.createElement("h1");
        heading.textContent = "预览内容已绘制";
        body.append(heading);
      });
    await expect(preview).toHaveAttribute("data-preview-ready", "true");
    // An occluded macOS test window may not publish FCP. In that case the
    // bounded fallback must be reported honestly instead of called verified.
    const outcome = await preview.getAttribute("data-preview-outcome");
    expect(["verified", "degraded"]).toContain(outcome);
    if (outcome === "degraded") {
      expect(["paint-timeout", "host-timeout"])
        .toContain(await preview.getAttribute("data-preview-degradation"));
    }
    await expect(page.frameLocator('iframe[title="HTML 交互预览"]').getByText("预览内容已绘制"))
      .toBeVisible();
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a valid blank Preview opens through the bounded display fallback", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  const fixture = createSourceFixture("blank-preview-result.html", () => (
    "<!DOCTYPE html><html><head><meta charset=\"utf-8\"><title>Blank preview</title></head><body data-native-case=\"blank-root\"></body></html>"
  ));
  const launched = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  try {
    const page = launched.page;
    await loadedDiskFrame(page, fixture.sourcePath, "blank-root");
    await page.getByRole("group", { name: "工作模式" })
      .getByRole("button", { name: "预览" }).click();
    const preview = page.getByTestId("workbench-active-preview");
    await expect(preview).toHaveAttribute("data-preview-ready", "true");
    await expect(preview).toHaveAttribute("data-preview-outcome", "degraded");
    await expect(preview).toHaveAttribute("data-preview-degradation", /^(paint-timeout|host-timeout)$/u);
    await expect(preview.getByRole("status")).toHaveCount(0);
    const marks = await page.evaluate(() => performance.getEntriesByType("mark")
      .filter((entry) => entry.name.startsWith("stemmio:preview:"))
      .map((entry) => ({ name: entry.name, detail: entry.detail })));
    expect(marks.some((mark) => mark.name === "stemmio:preview:session-created")).toBe(true);
    expect(marks.some((mark) => mark.name === "stemmio:preview:display-result"
      && mark.detail?.status === "degraded")).toBe(true);
    expect(marks.every((mark) => !Object.keys(mark.detail || {})
      .some((key) => /html|sourcePath|absolutePath/iu.test(key)))).toBe(true);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron restores the bounded legacy tab toolbar action without running authored handlers", {
  tag: ["@gate-smoke", "@smoke-editing"],
}, async () => {
  const legacyHtml = readFileSync(
    new URL("../../fixtures/native-dom/onclick-indexed-tabs.html", import.meta.url),
    "utf8",
  );
  const fixture = createSourceFixture("bounded-legacy-tabs.html", () => legacyHtml);
  const launched = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  try {
    const { editor, frame } = await loadedDiskFrame(
      launched.page, fixture.sourcePath, "onclick-indexed-tab-two",
    );
    const working = await launched.page.evaluate(() => window.stemmioProjects?.getActiveProject());
    const before = readFileSync(working.sourcePath);
    const firstPanel = frame.locator("#chart0");
    const secondPanel = frame.locator("#chart1");
    await frame.locator(caseSelector("onclick-indexed-tab-two")).click();
    await expect(firstPanel).toBeVisible();
    await expect(secondPanel).toBeHidden();
    await editor.getByRole("button", { name: "切换到此页签" }).click();
    await expect(firstPanel).toBeHidden();
    await expect(secondPanel).toBeVisible();
    expect(await frame.evaluate(() => document.documentElement.dataset.authorAction ?? null))
      .toBeNull();
    expect(readFileSync(working.sourcePath).equals(before)).toBe(true);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron keeps a failed tab switch recoverable until the user retries", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("retry-switch-a.html");
  const projectB = createSourceFixture("retry-switch-b.html");
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
  });
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await openRecentProject(launched.page, projectB.sourcePath);
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    let failOpen = true;
    let failedRequests = 0;
    await launched.page.route("**/workspace?*", async (route) => {
      const source = new URL(route.request().url()).searchParams.get("sourcePath");
      if (failOpen && source && path.basename(source) === path.basename(projectA.sourcePath)) {
        failedRequests += 1;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "TEST_OPEN_FAILED", message: "测试当前稿打开失败" } }),
        });
        return;
      }
      await route.continue();
    });
    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" });
    await tabs.getByRole("tab").filter({ hasText: "retry-switch-a" }).click();
    await expect.poll(() => failedRequests).toBeGreaterThan(0);
    const failure = launched.page.getByRole("alert").filter({ hasText: /无法打开|暂时无法显示/u });
    await expect(failure).toBeVisible();
    await expect(failure.getByRole("button", { name: "重试打开" })).toBeVisible();
    failOpen = false;
    await failure.getByRole("button", { name: "重试打开" }).click();
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await expect(failure).toHaveCount(0);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("Electron keeps the comment lane width stable across current-draft tab switches", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("tab-width-a.html");
  const projectB = createSourceFixture("tab-width-b.html");
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
  });
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await openRecentProject(launched.page, projectB.sourcePath);
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" });
    const tabA = tabs.getByRole("tab").filter({ hasText: "tab-width-a" });
    const tabB = tabs.getByRole("tab").filter({ hasText: "tab-width-b" });
    await launched.page.evaluate(() => {
      const stage = document.querySelector(".review-scroll-stage");
      const canvas = stage?.querySelector(".canvas-column");
      const read = () => ({
        t: performance.now(),
        inspector: stage?.getAttribute("data-inspector"),
        stage: stage?.getBoundingClientRect().width || 0,
        canvas: canvas?.getBoundingClientRect().width || 0,
        rail: stage?.querySelector(".comments-panel.comment-rail")?.getBoundingClientRect().width || 0,
        selected: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() || "",
      });
      window.__STEMMIO_TEST_TAB_WIDTH_TRACE__ = [read()];
      const sample = () => {
        window.__STEMMIO_TEST_TAB_WIDTH_TRACE__.push(read());
        window.__STEMMIO_TEST_TAB_WIDTH_RAF__ = requestAnimationFrame(sample);
      };
      window.__STEMMIO_TEST_TAB_WIDTH_RAF__ = requestAnimationFrame(sample);
    });
    await holdCanvasLoads(launched.page);
    await tabA.click();
    const outgoing = launched.page.locator("[data-outgoing-draft]");
    await expect(outgoing).toBeVisible();
    await expect(outgoing).toHaveAttribute("inert", "");
    const handoffGeometry = await launched.page.evaluate(() => {
      const stage = document.querySelector(".review-scroll-stage");
      const canvas = stage?.querySelector(".canvas-column");
      const rail = stage?.querySelector(".comments-panel.comment-rail");
      return {
        inspector: stage?.getAttribute("data-inspector"),
        canvas: canvas?.getBoundingClientRect().width || 0,
        rail: rail?.getBoundingClientRect().width || 0,
      };
    });
    expect(handoffGeometry.inspector).toBe("comments");
    expect(handoffGeometry.rail).toBeGreaterThan(0);
    await launched.page.screenshot({ path: test.info().outputPath("outgoing-draft-with-comments.png") });
    await releaseCanvasLoadHold(launched.page);
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await tabB.click();
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    await launched.page.screenshot({ path: test.info().outputPath("active-draft-with-comments.png") });
    const trace = await launched.page.evaluate(() => {
      cancelAnimationFrame(window.__STEMMIO_TEST_TAB_WIDTH_RAF__);
      return window.__STEMMIO_TEST_TAB_WIDTH_TRACE__;
    });
    const canvasWidths = trace.map((sample) => sample.canvas);
    const railWidths = trace.map((sample) => sample.rail);
    expect(Math.max(...canvasWidths) - Math.min(...canvasWidths), JSON.stringify(trace.filter((sample, index) => (
      index === 0 || sample.canvas !== trace[index - 1].canvas || sample.inspector !== trace[index - 1].inspector
    )))).toBeLessThanOrEqual(2);
    expect(Math.min(...railWidths)).toBeGreaterThan(0);
  } finally {
    await releaseCanvasLoadHold(launched.page);
    await launched.page.evaluate(() => {
      cancelAnimationFrame(window.__STEMMIO_TEST_TAB_WIDTH_RAF__);
      delete window.__STEMMIO_TEST_TAB_WIDTH_TRACE__;
      delete window.__STEMMIO_TEST_TAB_WIDTH_RAF__;
    }).catch(() => {});
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

async function interceptExternalBrowserOpen(electronApp) {
  await electronApp.evaluate(({ shell }) => {
    globalThis.__stemmioOpenedExternalUrls = [];
    shell.openExternal = async (sourceUrl) => {
      globalThis.__stemmioOpenedExternalUrls.push(sourceUrl);
    };
  });
}

async function openedExternalUrls(electronApp) {
  return electronApp.evaluate(() => (
    globalThis.__stemmioOpenedExternalUrls || []
  ));
}

async function holdCanvasLoads(page) {
  await page.evaluate(() => {
    // Hold access to the next Canvas document, before either the load handler
    // or parsed-frame probe can connect it. Rewriting data-render-verified
    // after connection suppresses deferred Runtime replay without a real
    // readiness transition when the saved handler is released.
    const descriptor = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "contentDocument");
    const existingDocuments = new WeakMap();
    for (const frame of document.querySelectorAll('[data-testid="html-canvas-editor"] iframe')) {
      existingDocuments.set(frame, descriptor.get.call(frame));
    }
    window.__STEMMIO_TEST_CANVAS_DOCUMENT_DESCRIPTOR__ = descriptor;
    Object.defineProperty(HTMLIFrameElement.prototype, "contentDocument", {
      ...descriptor,
      get() {
        const documentNode = descriptor.get.call(this);
        if (window.__STEMMIO_TEST_BLOCK_CANVAS_LOAD__
          && this.closest('[data-testid="html-canvas-editor"]')
          && this.getAttribute("data-runtime-slot-role") === "active"
          && existingDocuments.get(this) !== documentNode) return null;
        return documentNode;
      },
    });
    const reactLoadHandler = (frame) => {
      const propsKey = Object.keys(frame).find((key) => key.startsWith("__reactProps$"));
      return propsKey ? frame[propsKey]?.onLoad || null : null;
    };
    const captureLoad = (event) => {
      const target = event.target;
      if (!(target instanceof HTMLIFrameElement)) return;
      if (
        target.closest('[data-testid="html-canvas-editor"]')
        && target.getAttribute("data-runtime-slot-role") === "active"
        && window.__STEMMIO_TEST_BLOCK_CANVAS_LOAD__
      ) {
        window.__STEMMIO_TEST_DELAYED_CANVAS_FRAME__ = target;
        window.__STEMMIO_TEST_DELAYED_CANVAS_ON_LOAD__ = reactLoadHandler(target);
        event.stopImmediatePropagation();
        event.stopPropagation();
      }
    };
    window.__STEMMIO_TEST_BLOCK_CANVAS_LOAD__ = true;
    window.__STEMMIO_TEST_HANDOFF_LOAD_CAPTURE__ = captureLoad;
    document.addEventListener("load", captureLoad, true);
  });
}

async function releaseCanvasLoadHold(page) {
  await page.evaluate(() => {
    const captureLoad = window.__STEMMIO_TEST_HANDOFF_LOAD_CAPTURE__;
    if (captureLoad) document.removeEventListener("load", captureLoad, true);
    delete window.__STEMMIO_TEST_HANDOFF_LOAD_CAPTURE__;
    delete window.__STEMMIO_TEST_BLOCK_CANVAS_LOAD__;
    const descriptor = window.__STEMMIO_TEST_CANVAS_DOCUMENT_DESCRIPTOR__;
    if (descriptor) Object.defineProperty(HTMLIFrameElement.prototype, "contentDocument", descriptor);
    delete window.__STEMMIO_TEST_CANVAS_DOCUMENT_DESCRIPTOR__;
    delete window.__STEMMIO_TEST_DELAYED_CANVAS_FRAME__;
    delete window.__STEMMIO_TEST_DELAYED_CANVAS_ON_LOAD__;
  }).catch(() => {});
}

async function confirmHistoryCreation(page) {
  const dialog = page.getByRole("dialog", { name: /创建新版本/u });
  const confirm = dialog.getByRole("button", { name: "创建并编辑", exact: true });
  const cancel = dialog.getByRole("button", { name: "取消", exact: true });
  await expect(dialog).toBeVisible();
  await expect(cancel).toBeFocused();
  // These journeys verify durable history creation and restart recovery, not
  // native pointer injection. A saturated Electron batch can acknowledge a
  // Playwright click before the renderer consumes it, so order the test after
  // the React handler through the renderer, as the AI cancellation dialog does.
  await confirm.dispatchEvent("click");
  await expect(dialog).not.toBeVisible();
}

test("Electron tab keyboard navigation manages focus and a persisted Start suppresses activePath restart", {
  tag: ["@gate-smoke","@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("workbench-tabs-restart.html");
  const firstLaunch = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  let firstClosed = false;
  let reopened = null;
  try {
    await loadedDiskFrame(firstLaunch.page, fixture.sourcePath, "list-item");
    const tablist = firstLaunch.page.getByRole("tablist", { name: "已打开的页面" });
    await expect(tablist.getByRole("tab")).toHaveCount(1);
    await firstLaunch.page.getByRole("button", { name: "新标签页" }).click();
    await firstLaunch.page.getByRole("button", { name: "新标签页" }).click();
    await expect(tablist.getByRole("tab")).toHaveCount(3);

    const documentTab = tablist.getByRole("tab").nth(0);
    const firstStart = tablist.getByRole("tab").nth(1);
    const lastStart = tablist.getByRole("tab").nth(2);
    await expect(lastStart).toHaveAttribute("aria-selected", "true");
    await lastStart.focus();

    await lastStart.press("ArrowLeft");
    await expect(firstStart).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await expect(firstStart).toBeFocused();
    await firstStart.press("ArrowLeft");
    await expect(documentTab).toHaveAttribute("aria-selected", "true");
    await expect(documentTab).toBeFocused();
    await loadedDiskFrame(firstLaunch.page, fixture.sourcePath, "list-item");
    await documentTab.press("ArrowRight");
    await expect(firstStart).toHaveAttribute("aria-selected", "true");
    await expect(firstStart).toBeFocused();
    await firstStart.press("Home");
    await expect(documentTab).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await expect(documentTab).toBeFocused();
    await loadedDiskFrame(firstLaunch.page, fixture.sourcePath, "list-item");
    await firstLaunch.page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    await documentTab.press("End");
    await expect(lastStart).toHaveAttribute("aria-selected", "true");
    await expect(lastStart).toBeFocused();

    const tabsStatePath = path.join(firstLaunch.isolatedUserData, "workbench-tabs.json");
    await expect.poll(() => {
      try {
        return JSON.parse(readFileSync(tabsStatePath, "utf8"));
      } catch {
        return null;
      }
    }).toMatchObject({ version: 2, activeTabId: null });

    await closeStemmioGracefully(firstLaunch.electronApp, firstLaunch.page);
    firstClosed = true;
    reopened = await launchStemmio({ isolatedUserData: firstLaunch.isolatedUserData });
    const reopenedTabs = reopened.page.getByRole("tablist", { name: "已打开的页面" });
    await expect(reopenedTabs.getByRole("tab")).toHaveCount(2);
    await expect(reopenedTabs.getByRole("tab").nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(reopened.page.locator("main.workbench")).toHaveAttribute("data-start-page", "true");
    await expect(reopened.page.locator("main.workbench")).toHaveAttribute("data-project-state", "unbound");
    await expect(reopenedTabs.getByRole("tab").nth(1)).not.toHaveText("HTML");

    const startPage = reopened.page.locator(".workbench-start-page");
    await expect(startPage.getByRole("heading", { name: "开始" })).toBeVisible();
    await expect(startPage.getByRole("button", { name: "新建项目" })).toBeVisible();
    await expect(startPage.getByRole("heading", { name: "继续编辑" })).toBeVisible();
    await startPage.locator(".workbench-start-resume").click();
    await expect(reopenedTabs.getByRole("tab")).toHaveCount(1, { timeout: 60_000 });
    await expect(reopenedTabs.getByRole("tab").first()).toHaveAttribute("aria-selected", "true");
    await loadedDiskFrame(reopened.page, fixture.sourcePath, "list-item");
    const documentTitle = (await reopenedTabs.getByRole("tab").first().innerText()).trim();

    await reopened.page.getByRole("button", { name: "新标签页" }).click();
    await expect(reopenedTabs.getByRole("tab")).toHaveCount(2);
    const activeStart = reopenedTabs.getByRole("tab").nth(1);
    await expect(activeStart).toHaveAttribute("aria-selected", "true");
    const inactiveClose = reopened.page.getByRole("button", { name: `关闭 ${documentTitle}` });
    await inactiveClose.focus();
    await inactiveClose.press("Enter");
    await expect(reopenedTabs.getByRole("tab")).toHaveCount(1);
    await expect(reopenedTabs.getByRole("tab").first()).toBeFocused();

    await reopened.page.getByRole("button", { name: "新标签页" }).click();
    await expect(reopenedTabs.getByRole("tab")).toHaveCount(2);
    const closingActiveStart = reopenedTabs.getByRole("tab").nth(1);
    await closingActiveStart.focus();
    await closingActiveStart.press(process.platform === "darwin" ? "Meta+w" : "Control+w");
    await expect(reopenedTabs.getByRole("tab")).toHaveCount(1);
    await expect(reopenedTabs.getByRole("tab").first()).toBeFocused();
  } finally {
    if (reopened) {
      await stopStemmio(reopened.electronApp, reopened.isolatedUserData);
    } else if (!firstClosed) {
      await stopStemmio(firstLaunch.electronApp, firstLaunch.isolatedUserData);
    } else {
      removeIsolatedUserData(firstLaunch.isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron settings routes categories and persists restore preference without hiding external opens", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(240_000);
  const fixture = createSourceFixture("settings-workspace-preferences.html");
  const first = await launchStemmio({
    activeSourcePath: fixture.sourcePath,
  });
  let firstClosed = false;
  let reopened = null;
  let reopenedClosed = false;
  let external = null;
  try {
    await loadedDiskFrame(first.page, fixture.sourcePath, "list-item");
    await waitForProjectReady(first.page);
    const guideClose = first.page.getByRole("button", { name: "跳过这次说明" });
    if (await guideClose.count()) await guideClose.click();

    await first.page.getByRole("button", { name: "展开左侧边栏" }).click();
    const sidebar = first.page.locator(".workbench-global-sidebar");
    const preferencesPath = path.join(first.isolatedUserData, "ui-preferences.json");
    const sidebarResizer = sidebar.locator('[data-resizer="sidebar"]');
    await sidebarResizer.focus();
    await sidebarResizer.press("ArrowRight");
    await expect.poll(() => {
      try {
        return JSON.parse(readFileSync(preferencesPath, "utf8"));
      } catch {
        return null;
      }
    }).toMatchObject({
      schemaVersion: 2,
      workspace: { sidebarWidth: 280 },
    });
    await sidebar.getByRole("button", { name: "设置", exact: true }).click();
    const settings = first.page.locator(".workbench-settings-page");
    await expect(settings.getByRole("heading", { name: "常规" })).toBeFocused();
    await expect(settings).not.toContainText("智能滚动");
    await expect(settings).not.toContainText("快捷键提示");
    await expect(settings).not.toContainText("最近打开记录");
    const visibleToast = first.page.locator(".toast.show");
    await visibleToast.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
    if (await visibleToast.isVisible().catch(() => false)) {
      await visibleToast.getByRole("button", { name: "关闭提醒" }).click();
      await expect(visibleToast).toBeHidden();
    }
    const captureDirectory = process.env.STEMMIO_CAPTURE_SETTINGS_DIR
      ? path.resolve(process.env.STEMMIO_CAPTURE_SETTINGS_DIR)
      : null;
    const captureSettings = async (name, width, height) => {
      if (!captureDirectory) return;
      mkdirSync(captureDirectory, { recursive: true });
      const bounds = await first.electronApp.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => (
          candidate.webContents.getURL().includes("/dist-desktop/renderer/")
          || candidate.getTitle() === "源页"
        ));
        return window?.getBounds() || null;
      });
      await first.electronApp.evaluate(({ BrowserWindow }, nextBounds) => {
        const window = BrowserWindow.getAllWindows().find((candidate) => (
          candidate.webContents.getURL().includes("/dist-desktop/renderer/")
          || candidate.getTitle() === "源页"
        ));
        window?.setBounds(nextBounds, false);
      }, { ...(bounds || {}), width, height });
      await expect.poll(() => first.page.evaluate(() => window.innerWidth)).toBe(width);
      await first.page.waitForTimeout(220);
      await first.page.screenshot({
        path: path.join(captureDirectory, `${name}.png`),
        animations: "disabled",
      });
    };
    await captureSettings("settings-general-1440x1024", 1440, 1024);
    await captureSettings("settings-general-1024x768", 1024, 768);
    await captureSettings("settings-general-960x720", 960, 720);

    const changeContext = settings.getByRole("slider", {
      name: "变化聚焦时的上下文可见度",
    });
    const commentContext = settings.getByRole("slider", {
      name: "评论聚焦时的上下文可见度",
    });
    await expect(changeContext).toHaveValue("25");
    await expect(commentContext).toHaveValue("15");
    await changeContext.fill("31");
    await expect(commentContext).toBeEnabled();
    await commentContext.fill("19");
    await expect.poll(() => {
      try {
        return JSON.parse(readFileSync(preferencesPath, "utf8"));
      } catch {
        return null;
      }
    }).toMatchObject({
      workspace: {
        reviewChangeContextVisibility: 31,
        reviewCommentContextVisibility: 19,
      },
    });
    await settings.getByRole("button", { name: "恢复默认可见度", exact: true }).click();
    await expect(changeContext).toHaveValue("25");
    await expect(commentContext).toHaveValue("15");

    await settings.getByRole("checkbox", { name: "启动时恢复上次标签页" }).uncheck();
    await expect.poll(() => {
      try {
        return JSON.parse(readFileSync(preferencesPath, "utf8"));
      } catch {
        return null;
      }
    }).toMatchObject({
      schemaVersion: 2,
      workspace: { restoreTabsOnLaunch: false },
    });

    await first.page.getByRole("button", { name: "AI 服务", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "AI 服务", level: 1 })).toBeFocused();
    await captureSettings("settings-agent-1440x1024", 1440, 1024);
    await settings.getByTestId("settings-agent-row-action-codex").click();
    await expect.poll(() => {
      try {
        return JSON.parse(readFileSync(preferencesPath, "utf8"));
      } catch {
        return null;
      }
    }).toMatchObject({ workspace: { defaultAgentProviderId: "qoder" } });
    await first.page.getByRole("button", { name: "软件更新", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "软件更新" })).toBeFocused();
    await captureSettings("settings-updates-1440x1024", 1440, 1024);

    const tabs = first.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    await tabs.filter({ hasText: "settings-workspace-preferences" }).click();
    await expect(settings).toHaveCount(0);
    await first.page.getByRole("tab", { name: "设置", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "软件更新" })).toBeFocused();

    await first.page.getByRole("button", { name: "返回工作台" }).click();
    await expect(settings).toHaveCount(0);
    await sidebar.getByRole("button", { name: "设置", exact: true }).click();
    await expect(settings.getByRole("heading", { name: "常规" })).toBeFocused();
    await expect(settings.getByRole("checkbox", { name: "启动时恢复上次标签页" }))
      .not.toBeChecked();
    await settings.getByRole("checkbox", { name: "记住面板宽度" }).uncheck();
    await expect.poll(() => {
      try {
        return JSON.parse(readFileSync(preferencesPath, "utf8"));
      } catch {
        return null;
      }
    }).toMatchObject({ workspace: { rememberPanelWidths: false } });
    await first.page.getByRole("button", { name: "返回工作台" }).click();
    await sidebarResizer.focus();
    await sidebarResizer.press("ArrowRight");
    await expect.poll(() => {
      try {
        return JSON.parse(readFileSync(preferencesPath, "utf8"))?.workspace?.sidebarWidth;
      } catch {
        return null;
      }
    }).toBe(280);

    await closeStemmioGracefully(first.electronApp, first.page);
    firstClosed = true;
    reopened = await launchStemmio({
      isolatedUserData: first.isolatedUserData,
    });
    const reopenedTabs = reopened.page.getByRole("tablist", { name: "已打开的页面" })
      .getByRole("tab");
    await expect(reopened.page.locator("main.workbench")).toHaveAttribute(
      "data-start-page",
      "true",
    );
    await expect.poll(() => reopened.page.locator("main.workbench").evaluate((element) => (
      getComputedStyle(element).getPropertyValue("--workbench-sidebar-width-saved").trim()
    ))).toBe("280px");
    await expect(reopenedTabs).toHaveCount(1);
    await closeStemmioGracefully(reopened.electronApp, reopened.page);
    reopenedClosed = true;

    external = await launchStemmio({
      isolatedUserData: first.isolatedUserData,
      externalSourcePaths: [fixture.sourcePath],
    });
    await loadedDiskFrame(external.page, fixture.sourcePath, "list-item");
    await expect(external.page.locator("main.workbench")).not.toHaveAttribute(
      "data-start-page",
      "true",
    );
  } finally {
    if (external) {
      await stopStemmio(external.electronApp, external.isolatedUserData);
    } else if (reopened && !reopenedClosed) {
      await stopStemmio(reopened.electronApp, reopened.isolatedUserData);
    } else if (!firstClosed) {
      await stopStemmio(first.electronApp, first.isolatedUserData);
    } else {
      removeIsolatedUserData(first.isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron restores multiple Registry tabs, the persisted active document, and external cold-start priority", {
  tag: ["@gate-smoke","@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(300_000);
  const projectA = createSourceFixture("registry-restart-a.html");
  const projectB = createSourceFixture("registry-restart-b.html");
  const projectC = createSourceFixture("external-cold-priority-c.html");
  const first = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
  });
  let firstClosed = false;
  let restored = null;
  let restoredClosed = false;
  let external = null;
  try {
    await loadedDiskFrame(first.page, projectA.sourcePath, "list-item");
    await openRecentProject(first.page, projectB.sourcePath);
    const firstTabs = first.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    await expect(firstTabs).toHaveCount(2);
    await expect(firstTabs.filter({ hasText: "registry-restart-b" })).toHaveAttribute("aria-selected", "true");
    const workbench = first.page.locator("main.workbench");
    const generationBeforeA = Number(await workbench.getAttribute(
      "data-canvas-generation",
    ));
    await firstTabs.filter({ hasText: "registry-restart-a" }).click();
    await loadedDiskFrame(first.page, projectA.sourcePath, "list-item");
    expect(Number(await workbench.getAttribute("data-canvas-generation")))
      .toBe(generationBeforeA + 1);
    await expect(first.page.getByTestId("html-canvas-editor")).toHaveCount(1);
    const generationBeforeB = Number(await workbench.getAttribute(
      "data-canvas-generation",
    ));
    await firstTabs.filter({ hasText: "registry-restart-b" }).click();
    await loadedDiskFrame(first.page, projectB.sourcePath, "list-item");
    expect(Number(await workbench.getAttribute("data-canvas-generation")))
      .toBe(generationBeforeB + 1);
    const tabsStatePath = path.join(first.isolatedUserData, "workbench-tabs.json");
    await expect.poll(() => {
      try {
        return JSON.parse(readFileSync(tabsStatePath, "utf8"));
      } catch {
        return null;
      }
    }).toMatchObject({
      activeTabId: expect.stringContaining("document:"),
      tabs: expect.arrayContaining([
        expect.objectContaining({ projectId: expect.stringContaining("project_") }),
        expect.objectContaining({ projectId: expect.stringContaining("project_") }),
      ]),
    });
    await closeStemmioGracefully(first.electronApp, first.page);
    firstClosed = true;

    restored = await launchStemmio({ isolatedUserData: first.isolatedUserData });
    await loadedDiskFrame(restored.page, projectB.sourcePath, "list-item");
    const restoredTabs = restored.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    await expect(restoredTabs.filter({ hasText: "registry-restart-a" })).toHaveCount(1);
    await expect(restoredTabs.filter({ hasText: "registry-restart-b" })).toHaveCount(1);
    await expect(restoredTabs.filter({ hasText: "registry-restart-b" })).toHaveAttribute("aria-selected", "true");
    await expect(restored.page.getByTestId("html-canvas-editor")).toHaveCount(1);

    await closeStemmioGracefully(restored.electronApp, restored.page);
    restoredClosed = true;

    external = await launchStemmio({
      isolatedUserData: first.isolatedUserData,
      externalSourcePaths: [projectC.sourcePath],
    });
    await loadedDiskFrame(external.page, projectC.sourcePath, "list-item");
    const externalTabs = external.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    await expect(externalTabs.filter({ hasText: "external-cold-priority-c" }))
      .toHaveAttribute("aria-selected", "true");
  } finally {
    if (external) {
      await stopStemmio(external.electronApp, external.isolatedUserData);
    } else if (restored && !restoredClosed) {
      await stopStemmio(restored.electronApp, restored.isolatedUserData);
    } else if (!firstClosed) {
      await stopStemmio(first.electronApp, first.isolatedUserData);
    } else {
      removeIsolatedUserData(first.isolatedUserData);
    }
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
    removeSourceFixture(projectC.sourceDirectory);
  }
});

test("Electron restores the visible reading position and Preview mode after HTML cache eviction", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(240_000);
  const projectA = createSourceFixture("tab-reading-a.html", (source) => source.replace(
    /<\/body>/iu,
    `<section data-p="reading-tail" style="min-height:3200px;padding-top:120px">READING_TAIL_A</section></body>`,
  ));
  const projectB = createSourceFixture("tab-reading-b.html");
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
    injectedEnv: { STEMMIO_E2E_DOCUMENT_SURFACE_CACHE_MAX_ENTRIES: "1" },
  });
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    const stage = launched.page.locator(".review-scroll-stage");
    await expect.poll(() => stage.evaluate((element) => (
      element.scrollHeight - element.clientHeight
    ))).toBeGreaterThan(1_500);
    await stage.evaluate((element) => element.scrollTo({ top: 1_200, behavior: "auto" }));
    const editScrollTop = await expect.poll(() => stage.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(1_000)
      .then(() => stage.evaluate((element) => element.scrollTop));

    await openRecentProject(launched.page, projectB.sourcePath);
    const workbench = launched.page.locator("main.workbench");
    await expect(workbench).toHaveAttribute("data-document-cache-max-entries", "1");
    await expect(workbench).toHaveAttribute("data-document-cache-entry-count", "1");
    await expect(workbench).toHaveAttribute("data-document-cache-cold-count", "1");
    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    const tabA = tabs.filter({ hasText: "tab-reading-a" });
    const tabB = tabs.filter({ hasText: "tab-reading-b" });

    await tabA.click();
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await expect.poll(() => stage.evaluate((element) => element.scrollTop)).toBeGreaterThan(
      editScrollTop - 40,
    );

    const mode = launched.page.getByRole("group", { name: "工作模式", exact: true });
    await mode.getByRole("button", { name: "预览", exact: true }).click();
    const previewFrame = launched.page.frameLocator('iframe[title="HTML 交互预览"]');
    await expect(previewFrame.locator("body")).toBeVisible();
    await previewFrame.locator("body").evaluate(() => window.scrollTo({ top: 900, behavior: "auto" }));
    const previewScrollTop = await expect.poll(() => previewFrame.locator("body").evaluate(() => window.scrollY))
      .toBeGreaterThan(700)
      .then(() => previewFrame.locator("body").evaluate(() => window.scrollY));

    await tabB.click();
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");

    await tabA.click();
    await waitForProjectReady(launched.page);
    await expect(tabA).toHaveAttribute("aria-selected", "true");
    await expect(mode.getByRole("button", { name: "预览", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect(previewFrame.locator("body")).toBeVisible();
    await expect.poll(() => previewFrame.locator("body").evaluate(() => window.scrollY))
      .toBeGreaterThan(previewScrollTop - 40);
    await expect(launched.page.getByTestId("html-canvas-editor")).toHaveCount(1);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("Electron sidebar opens an imported historical version in the existing project tab", {
  tag: ["@gate-smoke","@smoke-project-lifecycle", "@smoke-version-display"],
}, async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("sidebar-history-a.html");
  const projectB = createSourceFixture("sidebar-history-b.html", (html) => html.replace("</body>", '<script>throw new Error("test dynamic author failure")</script></body>'));
  const launched = await launchStemmio({ activeSourcePath: projectA.sourcePath });
  let firstClosed = false;
  let reopened = null;
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await waitForProjectReady(launched.page);
    const managedAPath = await managedWorkingCopyPath(launched.page, projectA.sourcePath);
    const projectsRoot = path.dirname(path.dirname(managedAPath));
    const repository = new ProjectFileRepository({ projectsRoot });
    const imported = await repository.importExternal({
      sourcePath: projectB.sourcePath,
      expectedSourceSha256: sha256(readFileSync(projectB.sourcePath)),
    });
    let target = imported.target;
    for (const [ordinal, title] of Array.from({ length: 7 }, (_, index) => [index + 2, `sidebar history V${index + 2}`])) {
      if (ordinal === 4) {
        const base = await repository.readVersionFile({ target, versionId: "ver_0002" });
        const created = await repository.createVersionFromHistory({
          target, versionId: "ver_0002", operationId: "e2e_sidebar_branch_v2_0001",
          expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: base.sha256,
        });
        expect(created).toMatchObject({ versionId: "ver_0004", basedOnVersionId: "ver_0002", previousVersionId: "ver_0003" });
        const branched = (await repository.workspace({ sourcePath: created.sourcePath })).target;
        expect(branched.workingCopyId).toBe(target.workingCopyId);
        expect(branched.exactSourcePath).toBe(target.exactSourcePath);
        target = branched;
        continue;
      }
      const candidate = await repository.createCandidate({
        target,
        requestId: `req_sidebar_history_${ordinal}`,
        candidateId: `candidate_sidebar_history_${ordinal}_0001`,
        html: identityPreservingCandidateHtml(target, title),
        expectedSourceSha256: target.sourceSha256,
      });
      const promoted = await repository.promoteCandidate({
        target,
        candidateId: candidate.candidate.candidateId,
        decisionOperationId: `promote_${candidate.candidate.candidateId}`,
      });
      expect(promoted.promoted).toBe(true);
      target = promoted.target;
    }
    const importedSummary = await repository.listRegisteredProjectVersionSummaries({
      projectId: target.projectId,
    });
    const historicalVersion = importedSummary.versions.find((version) => (
      version.ordinal === 3
    ));
    expect(historicalVersion).toBeTruthy();
    const catalogRows = await launched.page.evaluate(() => window.stemmioProjects.listRegisteredProjects());
    expect(catalogRows.filter((row) => row.availability === "ready").every((row) => row.sourceStatus === "unknown")).toBe(true);


    await launched.page.getByRole("button", { name: "展开左侧边栏" }).click();
    const sidebar = launched.page.locator(".workbench-global-sidebar");
    await expect(sidebar).toHaveAttribute("data-open", "true");
    await expect(sidebar.locator(".sidebar-project-section")).toHaveCount(1);
    const currentProject = sidebar.locator(".sidebar-project-item")
      .filter({ hasText: "sidebar-history-a" })
      .first();
    await expect(currentProject.locator(".sidebar-project-row"))
      .toHaveAttribute("aria-expanded", "true");
    const beforeExpansion = await launched.page.evaluate(async () => (
      (await window.stemmioProjects?.getActiveProject())?.projectId || null
    ));
    const importedProject = sidebar.locator(".sidebar-project-item")
      .filter({ hasText: "sidebar-history-b" })
      .first();
    await expect(importedProject).toBeVisible();
    await importedProject.locator(".sidebar-project-row").click();
    await expect(importedProject.locator(".sidebar-project-current-row")).toBeVisible();
    await expect(importedProject.locator(".sidebar-project-history-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(importedProject.locator(".sidebar-version-file")).toHaveCount(0);
    await importedProject.locator(".sidebar-project-history-toggle").click();
    await expect(importedProject.locator(".sidebar-version-file")).toHaveCount(8, {
      timeout: 30_000,
    });
    expect(await launched.page.evaluate(async () => (
      (await window.stemmioProjects?.getActiveProject())?.projectId || null
    ))).toBe(beforeExpansion);

    await expect(importedProject.locator(".sidebar-version-index")).toHaveText(["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8"]);
    await expect(importedProject.locator("svg.sidebar-version-rail")).toHaveCount(0);
    await expect(importedProject.locator(".sidebar-project-load-error")).toHaveCount(0);
    await expect(importedProject.getByRole("button", { name: "重新检查文件" })).toHaveCount(0);
    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    await expect(tabs).toHaveCount(1);
    await importedProject.getByRole("button", {
      name: `V${historicalVersion.ordinal}，历史版本`,
      exact: true,
    }).click();
    await expect(tabs).toHaveCount(2, { timeout: 60_000 });
    const selectedB = launched.page.locator('.workbench-tab[data-kind="history"]')
      .filter({ hasText: "sidebar-history-b" })
      .getByRole("tab");
    const currentB = launched.page.locator('.workbench-tab[data-kind="document"]')
      .filter({ hasText: "sidebar-history-b" })
      .getByRole("tab");
    await expect(currentB).toHaveCount(0);
    await expect(selectedB)
      .toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await expect.poll(() => sidebar.locator(".sidebar-version-tree").count())
      .toBeGreaterThan(0);
    await expect(launched.page.locator(".preview-navigation-banner")).toHaveCount(0);

    const mode = launched.page.getByRole("group", { name: "工作模式", exact: true });
    await expect(selectedB).toHaveAccessibleName(`sidebar-history-b · 历史 V${historicalVersion.ordinal}`);
    await expect(importedProject.locator('[data-selected="true"] .sidebar-version-file')).toHaveAccessibleName(`V${historicalVersion.ordinal}，历史版本`);
    await expect(importedProject.locator('[data-selected="true"] .sidebar-version-time'))
      .toHaveAttribute("datetime", historicalVersion.modifiedAt);
    await expect(mode).toHaveAttribute("data-view-label", "历史");
    await expect(mode.getByRole("button", { name: "编辑", exact: true })).toBeDisabled();
    const historicalPreview = launched.page.frameLocator('iframe[title="HTML 交互预览"]');
    await expect(historicalPreview.locator("body")).toBeVisible();
    await expect.poll(async () => (await launched.page.locator('iframe[title="HTML 交互预览"]').boundingBox())?.height || 0).toBeGreaterThan(400);
    await expect(mode.getByRole("button", { name: "预览", exact: true })).toHaveAttribute("aria-pressed", "true");
    const protectedWorkingBytes = readFileSync(target.exactSourcePath, "utf8");
    await expect.poll(() => historicalPreview.locator("title").textContent()).toBe("sidebar history V3");
    await launched.page.screenshot({ path: test.info().outputPath("version-history-projection.png") });

    let releaseVersionFive;
    let versionFiveRequested = false;
    const delayVersionFive = async (route) => {
      if (new URL(route.request().url()).searchParams.get("versionId") !== "ver_0005") {
        await route.continue();
        return;
      }
      versionFiveRequested = true;
      await new Promise((resolve) => { releaseVersionFive = resolve; });
      await route.continue();
    };
    await launched.page.route("**/version-file?*", delayVersionFive);
    await importedProject.getByRole("button", { name: "V5，历史版本", exact: true }).click();
    await expect.poll(() => versionFiveRequested).toBe(true);
    await expect(selectedB).toHaveAccessibleName("sidebar-history-b · 历史 V3");
    await expect(importedProject.locator('[data-selected="true"] .sidebar-version-file'))
      .toHaveAccessibleName("V3，历史版本");
    await expect.poll(() => historicalPreview.locator("title").textContent()).toBe("sidebar history V3");
    releaseVersionFive();
    await expect(selectedB).toHaveAccessibleName("sidebar-history-b · 历史 V5");
    await expect(importedProject.locator('[data-selected="true"] .sidebar-version-file'))
      .toHaveAccessibleName("V5，历史版本");
    await expect.poll(() => historicalPreview.locator("title").textContent()).toBe("sidebar history V5");
    await launched.page.unroute("**/version-file?*", delayVersionFive);

    const rejectVersionSix = (route) => route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: "VERSION_SNAPSHOT_INVALID", message: "测试 V6 历史快照校验失败" } }),
    });
    await launched.page.route("**/version-file?*", rejectVersionSix);
    await importedProject.getByRole("button", { name: "V6，历史版本", exact: true }).click();
    await expect(launched.page.getByText("测试 V6 历史快照校验失败", { exact: true })).toBeVisible();
    await expect(selectedB).toHaveAccessibleName("sidebar-history-b · 历史 V5");
    await expect(importedProject.locator('[data-selected="true"] .sidebar-version-file'))
      .toHaveAccessibleName("V5，历史版本");
    await expect.poll(() => historicalPreview.locator("title").textContent()).toBe("sidebar history V5");
    await launched.page.unroute("**/version-file?*", rejectVersionSix);
    await importedProject.getByRole("button", {
      name: `V${historicalVersion.ordinal}，历史版本`,
      exact: true,
    }).click();
    await expect(selectedB).toHaveAccessibleName(`sidebar-history-b · 历史 V${historicalVersion.ordinal}`);
    await expect.poll(() => historicalPreview.locator("title").textContent()).toBe("sidebar history V3");

    await importedProject.locator(".sidebar-project-current-row").click();
    await expect(tabs).toHaveCount(3, { timeout: 60_000 });
    await expect(currentB).toHaveAttribute("aria-selected", "true");
    await expect(selectedB).toContainText("历史");
    expect(readFileSync(target.exactSourcePath, "utf8")).toBe(protectedWorkingBytes);
    await expect(launched.page.locator('iframe[title="HTML 交互预览"]')).toHaveCount(0);
    await expect(mode).toHaveAttribute("data-view-label", "当前");
    await expect(mode.getByRole("button", { name: "编辑", exact: true })).toBeEnabled();
    await expect(importedProject.locator(".sidebar-project-current-row")).toHaveAttribute("aria-current", "page");
    await expect(importedProject.locator('.sidebar-version-row[data-selected="true"]')).toHaveCount(0);
    const currentSummary = await repository.listRegisteredProjectVersionSummaries({ projectId: target.projectId });
    const latestVersion = currentSummary.versions.find((version) => version.ordinal === 8);
    await expect(importedProject.locator(".sidebar-version-row").filter({ has: launched.page.getByRole("button", { name: "V8，历史版本", exact: true }) }).locator(".sidebar-version-time"))
      .toHaveAttribute("datetime", latestVersion.modifiedAt);
    const protectedLatest = await repository.readVersionFile({ target, versionId: "ver_0008" });
    await launched.page.screenshot({ path: test.info().outputPath("version-current-projection.png") });

    const rejectHistory = (route) => route.fulfill({ status: 409, contentType: "application/json",
      body: JSON.stringify({ error: { code: "VERSION_SNAPSHOT_INVALID", message: "测试历史快照校验失败" } }) });
    await launched.page.route("**/version-file?*", rejectHistory);
    await importedProject.getByRole("button", { name: `V${historicalVersion.ordinal}，历史版本`, exact: true }).click();
    await expect(launched.page.getByText("测试历史快照校验失败", { exact: true })).toBeVisible();
    await expect(mode).toHaveAttribute("data-view-label", "当前");
    await expect(mode.getByRole("button", { name: "编辑", exact: true })).toBeEnabled();
    expect(readFileSync(target.exactSourcePath, "utf8")).toBe(protectedWorkingBytes);
    await launched.page.unroute("**/version-file?*", rejectHistory);


    await currentProject.locator(".sidebar-project-current-row").click();
    await expect(tabs).toHaveCount(3);
    await expect(launched.page.locator('.workbench-tab[data-kind="document"]')
      .filter({ hasText: "sidebar-history-a" }).getByRole("tab"))
      .toHaveAttribute("aria-selected", "true");
    await expect(mode).toHaveAttribute("data-view-label", "当前");
    await expect(importedProject.locator(".sidebar-version-index")).toHaveText(["V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8"]);
    await expect(importedProject.locator('[data-selected="true"]')).toHaveCount(0);
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    const historyButton = importedProject.getByRole("button", { name: `V${historicalVersion.ordinal}，历史版本`, exact: true });
    let rejectedCrossProjectReads = 0;
    const rejectCrossProjectHistory = async (route) => {
      rejectedCrossProjectReads += 1;
      await rejectHistory(route);
    };
    await launched.page.route("**/version-file?*", rejectCrossProjectHistory);
    await historyButton.click();
    await expect(launched.page.locator('.workbench-tab[data-kind="document"]')
      .filter({ hasText: "sidebar-history-a" }).getByRole("tab"))
      .toHaveAttribute("aria-selected", "true");
    await expect(currentB).toHaveAttribute("aria-selected", "false");
    await expect.poll(() => rejectedCrossProjectReads).toBe(1);
    await expect(launched.page.getByText("测试历史快照校验失败", { exact: true })).toBeVisible();
    await launched.page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    expect(rejectedCrossProjectReads).toBe(1);
    await expect(mode).toHaveAttribute("data-view-label", "当前");
    await launched.page.unroute("**/version-file?*", rejectCrossProjectHistory);
    await currentProject.locator(".sidebar-project-current-row").click();
    await expect(tabs.filter({ hasText: "sidebar-history-a" })).toHaveAttribute("aria-selected", "true");
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await historyButton.focus(); await historyButton.press("Enter");
    await expect(selectedB).toHaveAttribute("aria-selected", "true");
    await expect(selectedB).toContainText(`历史 V${historicalVersion.ordinal}`);
    await expect(mode).toHaveAttribute("data-view-label", "历史");
    const edit = mode.getByRole("button", { name: "编辑", exact: true });
    await expect(edit).toBeDisabled();
    await launched.page.getByRole("button", { name: "更多", exact: true }).click();
    await launched.page.getByRole("menuitem", { name: "基于此版本创建新版本…", exact: true }).click();
    const dialog = launched.page.getByRole("dialog", { name: /基于.*创建新版本/ });
    await expect(dialog).toBeVisible();
    await launched.page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    expect((await repository.listRegisteredProjectVersionSummaries({ projectId: target.projectId })).versions).toHaveLength(8);
    await expect(mode.getByRole("button", { name: "预览", exact: true })).toHaveAttribute("aria-pressed", "true");

    const exportPath = path.join(projectB.sourceDirectory, "exported-history-v3.html");
    await launched.electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, exportPath);
    await expect(launched.page.getByText("测试历史快照校验失败", { exact: true })).toHaveCount(0);
    const historicalBytes = await repository.readVersionFile({ target, versionId: "ver_0003" });
    await interceptExternalBrowserOpen(launched.electronApp);
    await launched.page.getByRole("button", { name: "更多", exact: true }).click();
    const saveHistoryItem = launched.page.getByRole("menuitem", { name: "保存为新版本", exact: true });
    await expect(saveHistoryItem).toHaveAttribute("aria-disabled", "true");
    await expect(launched.page.getByRole("menuitem", { name: "基于此版本创建新版本…", exact: true })).toBeEnabled();
    await expect(launched.page.getByRole("menuitem", { name: "在 Finder 中显示工作文件", exact: true })).toHaveAttribute("aria-disabled", "true");
    const openHistoryInBrowser = launched.page.getByRole("menuitem", { name: "在浏览器中打开此版本", exact: true });
    await expect(openHistoryInBrowser).toBeEnabled();
    await expect(launched.page.getByRole("menuitemcheckbox", { name: "同时保存为新版本", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(launched.page.getByRole("menuitem", { name: "找回此前的稿件…", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(launched.page.getByRole("menuitem", { name: "从磁盘重新载入 HTML", exact: true })).toHaveAttribute("aria-disabled", "true");
    await expect(launched.page.getByText("历史版本没有独立工作文件；请打开当前稿", { exact: true })).toBeVisible();
    await expect(saveHistoryItem).toBeFocused();
    await launched.page.keyboard.press("ArrowDown");
    await expect(launched.page.getByRole("menuitem", { name: "基于此版本创建新版本…", exact: true })).toBeFocused();
    await launched.page.keyboard.press("ArrowDown");
    const disabledFinderItem = launched.page.getByRole("menuitem", { name: "在 Finder 中显示工作文件", exact: true });
    await expect(disabledFinderItem).toBeFocused();
    await launched.page.keyboard.press("Enter");
    await expect(launched.page.getByRole("menu", { name: "更多操作" })).toBeVisible();
    await launched.page.screenshot({ path: test.info().outputPath("version-history-menu.png") });
    await openHistoryInBrowser.click();
    await expect.poll(() => openedExternalUrls(launched.electronApp)).toEqual([
      pathToFileURL(realpathSync(historicalBytes.path)).href,
    ]);
    expect(readFileSync(target.exactSourcePath, "utf8")).toBe(protectedWorkingBytes);
    await launched.page.getByRole("button", { name: "更多", exact: true }).click();
    await launched.page.getByRole("menuitem", { name: "导出此版本…", exact: true }).click();
    await expect.poll(() => { try { return readFileSync(exportPath, "utf8"); } catch { return null; } }).toBe(historicalBytes.content);
    expect(readFileSync(target.exactSourcePath, "utf8")).toBe(protectedWorkingBytes);

    let creates = 0;
    const loseReceipt = async (route) => { creates += 1; await route.fetch(); await route.abort("failed"); };
    await launched.page.route("**/history-version/create", loseReceipt);
    await launched.electronApp.evaluate(({ net }) => {
      const originalFetch = net.fetch.bind(net);
      globalThis.__STEMMIO_CREATED_OPEN_FAILURES__ = 0;
      globalThis.__STEMMIO_RESTORE_CREATED_OPEN_FETCH__ = () => {
        net.fetch = originalFetch;
        delete globalThis.__STEMMIO_RESTORE_CREATED_OPEN_FETCH__;
      };
      net.fetch = async (input, options) => {
        const url = new URL(String(input));
        if (url.pathname === "/registered-project/open") {
          globalThis.__STEMMIO_CREATED_OPEN_FAILURES__ += 1;
          return new Response(JSON.stringify({ error: {
            code: "TEST_OPEN_FAILED",
            message: "测试新稿打开失败",
          } }), { status: 503, headers: { "Content-Type": "application/json" } });
        }
        return originalFetch(input, options);
      };
    });
    await launched.page.getByRole("button", { name: "更多", exact: true }).click();
    await launched.page.getByRole("menuitem", { name: "基于此版本创建新版本…", exact: true }).click();
    // This is the second use of the same native <dialog> in this journey. Wait
    // for the reopened modal boundary before activating its new confirmation.
    await confirmHistoryCreation(launched.page);
    await expect(launched.page.getByRole("button", { name: "打开已创建版本", exact: true })).toBeEnabled({ timeout: 30_000 });
    const createdSummary = await repository.listRegisteredProjectVersionSummaries({ projectId: target.projectId });
    expect(createdSummary.versions).toHaveLength(9);
    expect(creates).toBe(1);
    await expect.poll(() => launched.electronApp.evaluate(() => (
      globalThis.__STEMMIO_CREATED_OPEN_FAILURES__ || 0
    ))).toBeGreaterThanOrEqual(1);
    expect((await repository.readVersionFile({ target, versionId: "ver_0008" })).content).toBe(protectedLatest.content);
    expect(readFileSync(target.exactSourcePath, "utf8")).toBe(historicalBytes.content);
    await expect(mode).toHaveAttribute("data-view-label", "历史");
    await launched.electronApp.evaluate(() => globalThis.__STEMMIO_RESTORE_CREATED_OPEN_FETCH__?.());
    await currentProject.locator(".sidebar-project-current-row").click();
    await expect(tabs.filter({ hasText: "sidebar-history-a" })).toHaveAttribute("aria-selected", "true");
    await expect(launched.page.getByRole("button", { name: "打开已创建版本", exact: true })).toHaveCount(0);
    await waitForProjectReady(launched.page);
    await importedProject.getByRole("button", { name: `V${historicalVersion.ordinal}，历史版本`, exact: true }).click();
    await expect(mode).toHaveAttribute("data-view-label", "历史");
    await expect(launched.page.getByRole("button", { name: "打开已创建版本", exact: true })).toBeEnabled();
    await launched.page.getByRole("button", { name: "打开已创建版本", exact: true }).click();
    await expect(currentB).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await expect(mode).toHaveAttribute("data-view-label", "当前");
    await expect(mode.getByRole("button", { name: "编辑", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(importedProject.locator(".sidebar-project-current-row")).toHaveAttribute("aria-current", "page");
    await expect(importedProject.locator('.sidebar-version-row[data-selected="true"]')).toHaveCount(0);
    expect(creates).toBe(1);
    const createdPath = await launched.page.evaluate(async () => (await window.stemmioProjects.getActiveProject()).sourcePath);
    expect(realpathSync(createdPath)).toBe(realpathSync(target.exactSourcePath));
    const { frame: createdFrame } = await loadedStaticDiskFrame(launched.page, createdPath, { expectedCase: "list-item", includeEditor: true });
    await activateNativeEdit(createdFrame, "list-item");
    await setTextSelection(createdFrame, "list-item", 0, 3);
    await launched.page.keyboard.insertText("HISTORY_V9_SAVED");
    await launched.page.keyboard.press(keyShortcut("S"));
    await expect.poll(() => {
      try {
        return readFileSync(createdPath, "utf8");
      } catch (cause) {
        if (cause?.code === "ENOENT") return null;
        throw cause;
      }
    }).toContain("HISTORY_V9_SAVED");
    expect((await repository.readVersionFile({ target, versionId: "ver_0003" })).content).toBe(historicalBytes.content);
    expect((await repository.readVersionFile({ target, versionId: "ver_0008" })).content).toBe(protectedLatest.content);
    expect((await repository.workspace({ sourcePath: createdPath })).target.workingCopyId).toBe(target.workingCopyId);
    await launched.page.screenshot({ path: test.info().outputPath("history-created-v9.png") });
    await closeStemmioGracefully(launched.electronApp, launched.page);
    firstClosed = true;
    reopened = await launchStemmio({ isolatedUserData: launched.isolatedUserData });
    await waitForProjectReady(reopened.page);
    await expect(reopened.page.getByRole("tab", { selected: true }))
      .toHaveAccessibleName(currentProjectTabName(createdPath));
    expect((await repository.listRegisteredProjectVersionSummaries({ projectId: target.projectId })).versions).toHaveLength(9);
    const { frame: restartedFrame } = await loadedStaticDiskFrame(reopened.page, createdPath, { expectedCase: "list-item", includeEditor: true });
    await expect(restartedFrame.locator(caseSelector("list-item"))).toContainText("HISTORY_V9_SAVED");
  } finally {
    if (reopened) await stopStemmio(reopened.electronApp, reopened.isolatedUserData);
    else if (!firstClosed) await stopStemmio(launched.electronApp, launched.isolatedUserData);
    else removeIsolatedUserData(launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("Electron history mounts and restores without any current-draft Runtime", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle", "@smoke-version-display"],
}, async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("history-without-current-runtime.html");
  let app = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  const userData = app.isolatedUserData;
  let firstClosed = false;
  try {
    await loadedDiskFrame(app.page, fixture.sourcePath, "list-item");
    await waitForProjectReady(app.page);
    const managedPath = await managedWorkingCopyPath(app.page, fixture.sourcePath);
    const repository = new ProjectFileRepository({
      projectsRoot: path.dirname(path.dirname(managedPath)),
    });
    const workspace = await repository.workspace({ sourcePath: managedPath });

    await app.page.getByRole("button", { name: "展开左侧边栏" }).click();
    const tablist = app.page.getByRole("tablist", { name: "已打开的页面" });
    const documentTabContainer = app.page.locator('.workbench-tab[data-kind="document"]');
    await documentTabContainer.getByRole("button", { name: /关闭/u }).click();
    await expect(app.page.locator('.workbench-tab[data-kind="document"]')).toHaveCount(0);
    await expect(app.page.locator('.workbench-tab[data-kind="start"]')
      .getByRole("tab")).toHaveAttribute("aria-selected", "true");

    const project = app.page.locator(".sidebar-project-item")
      .filter({ hasText: "history-without-current-runtime" }).first();
    const projectRow = project.locator(".sidebar-project-row");
    if (await projectRow.getAttribute("aria-expanded") !== "true") {
      await projectRow.click();
    }
    const historyToggle = project.locator(".sidebar-project-history-toggle");
    if (await historyToggle.getAttribute("aria-expanded") !== "true") {
      await historyToggle.click();
    }
    await project.getByRole("button", { name: "V1，历史版本", exact: true }).click();
    const historyTab = app.page.locator('.workbench-tab[data-kind="history"]')
      .getByRole("tab");
    await expect(historyTab).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await expect(app.page.locator('.workbench-tab[data-kind="document"]')).toHaveCount(0);
    await expect(app.page.getByTestId("workbench-active-document-canvas"))
      .toHaveAttribute("data-runtime-hot-count", "0");
    const preview = app.page.frameLocator('iframe[title="HTML 交互预览"]');
    await expect(preview.locator(caseSelector("list-item"))).toBeVisible();

    const startContainer = app.page.locator('.workbench-tab[data-kind="start"]');
    await startContainer.getByRole("button", { name: /关闭/u }).click();
    await expect(tablist.getByRole("tab")).toHaveCount(1);
    await expect(historyTab).toHaveAttribute("aria-selected", "true");
    const tabsStatePath = path.join(userData, "workbench-tabs.json");
    await expect.poll(() => {
      try {
        return JSON.parse(readFileSync(tabsStatePath, "utf8"));
      } catch {
        return null;
      }
    }).toMatchObject({
      activeTabId: `history:${workspace.project.projectId}:${workspace.project.documentId}`,
    });

    await closeStemmioGracefully(app.electronApp, app.page);
    firstClosed = true;
    app = await launchStemmio({ isolatedUserData: userData });
    await expect(app.page.locator('.workbench-tab[data-kind="history"]')
      .getByRole("tab")).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await expect(app.page.locator('.workbench-tab[data-kind="document"]')).toHaveCount(0);
    await expect(app.page.getByTestId("workbench-active-document-canvas"))
      .toHaveAttribute("data-runtime-hot-count", "0");
    await expect(app.page.frameLocator('iframe[title="HTML 交互预览"]')
      .locator(caseSelector("list-item"))).toBeVisible();
  } finally {
    if (firstClosed) {
      await stopStemmio(app.electronApp, app.isolatedUserData);
    } else {
      await stopStemmio(app.electronApp, userData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron history creation recreates a closed current-draft tab", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle", "@smoke-version-display"],
}, async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("history-create-closed-current.html");
  let app = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  const userData = app.isolatedUserData;
  try {
    await loadedDiskFrame(app.page, fixture.sourcePath, "list-item");
    const initialPath = await managedWorkingCopyPath(app.page, fixture.sourcePath);
    const repository = new ProjectFileRepository({
      projectsRoot: path.dirname(path.dirname(initialPath)),
    });
    let target = (await repository.workspace({ sourcePath: initialPath })).target;
    await closeStemmioGracefully(app.electronApp, app.page);
    app = null;
    const candidate = await repository.createCandidate({
      target,
      requestId: "req_closed_current_0001",
      candidateId: "candidate_closed_current_0001",
      html: identityPreservingCandidateHtml(target, "Closed current V2"),
      expectedSourceSha256: target.sourceSha256,
    });
    target = (await repository.promoteCandidate({
      target,
      candidateId: candidate.candidate.candidateId,
      decisionOperationId: `promote_${candidate.candidate.candidateId}`,
    })).target;
    app = await launchStemmio({ isolatedUserData: userData, activeSourcePath: target.exactSourcePath });
    await waitForProjectReady(app.page);
    await app.page.getByRole("button", { name: "展开左侧边栏", exact: true }).click();
    await app.page.locator(".sidebar-project-history-toggle").click();
    await app.page.getByRole("button", { name: "V1，历史版本", exact: true }).click();
    const mode = app.page.getByRole("group", { name: "工作模式", exact: true });
    await expect(mode).toHaveAttribute("data-view-label", "历史");
    await app.page.getByRole("button", {
      name: `关闭 ${currentProjectTabName(target.exactSourcePath)}`,
      exact: true,
    }).click();
    await expect(app.page.locator('.workbench-tab[data-kind="document"]')).toHaveCount(0);

    await app.page.getByRole("button", { name: "更多", exact: true }).click();
    await app.page.getByRole("menuitem", { name: "基于此版本创建新版本…", exact: true }).click();
    await confirmHistoryCreation(app.page);

    await expect.poll(async () => (
      await repository.listRegisteredProjectVersionSummaries({ projectId: target.projectId })
    ).versions.length).toBe(3);
    const currentTab = app.page.locator('.workbench-tab[data-kind="document"]').getByRole("tab");
    await expect(currentTab).toHaveCount(1, { timeout: 60_000 });
    await expect(currentTab).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await expect(currentTab).toHaveAccessibleName(currentProjectTabName(target.exactSourcePath));
    await expect(mode).toHaveAttribute("data-view-label", "当前");
    await expect(mode.getByRole("button", { name: "编辑", exact: true })).toBeEnabled();
    expect((await repository.listRegisteredProjectVersionSummaries({ projectId: target.projectId })).versions)
      .toHaveLength(3);
  } finally {
    if (app) await stopStemmio(app.electronApp, userData);
    else removeIsolatedUserData(userData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

for (const recoveryAction of ["current-row", "close-history"]) {
  test(`Electron created-history recovery reuses its navigation transaction: ${recoveryAction}`, {
    tag: ["@gate-smoke", "@smoke-project-lifecycle", "@smoke-version-display"],
  }, async () => {
    test.setTimeout(180_000);
    const fixture = createSourceFixture(`history-current-recovery-${recoveryAction}.html`);
    const app = await launchStemmio({ activeSourcePath: fixture.sourcePath });
    try {
      await loadedDiskFrame(app.page, fixture.sourcePath, "list-item");
      await waitForProjectReady(app.page);
      const initialPath = await managedWorkingCopyPath(app.page, fixture.sourcePath);
      const repository = new ProjectFileRepository({
        projectsRoot: path.dirname(path.dirname(initialPath)),
      });
      const target = (await repository.workspace({ sourcePath: initialPath })).target;
      await app.page.getByRole("button", { name: "展开左侧边栏", exact: true }).click();
      const project = app.page.locator(".sidebar-project-item").first();
      await project.locator(".sidebar-project-history-toggle").click();
      await project.getByRole("button", { name: "V1，历史版本", exact: true }).click();
      const mode = app.page.getByRole("group", { name: "工作模式", exact: true });
      await expect(mode).toHaveAttribute("data-view-label", "历史");

      let creates = 0;
      const countCreate = async (route) => {
        creates += 1;
        await route.continue();
      };
      const failCreatedWorkspace = async (route) => {
        if (creates > 0) {
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({
              error: { code: "TEST_OPEN_FAILED", message: "测试新稿打开失败" },
            }),
          });
          return;
        }
        await route.continue();
      };
      await app.page.route("**/history-version/create", countCreate);
      await app.page.route("**/workspace?*", failCreatedWorkspace);
      await app.page.getByRole("button", { name: "更多", exact: true }).click();
      await app.page.getByRole("menuitem", {
        name: "基于此版本创建新版本…",
        exact: true,
      }).click();
      await confirmHistoryCreation(app.page);
      await expect.poll(() => creates).toBe(1);
      await expect(app.page.getByRole("button", {
        name: "打开已创建版本",
        exact: true,
      })).toBeEnabled({ timeout: 30_000 });
      await expect.poll(async () => (
        await repository.listRegisteredProjectVersionSummaries({ projectId: target.projectId })
      ).versions.length).toBe(2);
      expect(creates).toBe(1);
      await app.page.unroute("**/workspace?*", failCreatedWorkspace);

      if (recoveryAction === "close-history") {
        await app.page.locator('.workbench-tab[data-kind="history"] .workbench-tab-close').click();
      } else {
        await project.locator(".sidebar-project-current-row").click();
      }

      const currentTab = app.page.locator('.workbench-tab[data-kind="document"]').getByRole("tab");
      await expect(currentTab).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
      await expect(mode).toHaveAttribute("data-view-label", "当前");
      await expect(mode.getByRole("button", { name: "编辑", exact: true })).toBeEnabled();
      await expect(app.page.getByRole("button", {
        name: "打开已创建版本",
        exact: true,
      })).toHaveCount(0);
      expect((await repository.listRegisteredProjectVersionSummaries({
        projectId: target.projectId,
      })).versions).toHaveLength(2);
      expect(creates).toBe(1);

      await app.page.getByRole("button", { name: "新标签页", exact: true }).click();
      const startTab = app.page.locator('.workbench-tab[data-kind="start"]').getByRole("tab");
      await expect(startTab).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
      await project.locator(".sidebar-project-current-row").click();
      await expect(currentTab).toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
      await expect(mode).toHaveAttribute("data-view-label", "当前");
      expect((await repository.listRegisteredProjectVersionSummaries({
        projectId: target.projectId,
      })).versions).toHaveLength(2);
      expect(creates).toBe(1);
    } finally {
      await stopStemmio(app.electronApp, app.isolatedUserData);
      removeSourceFixture(fixture.sourceDirectory);
    }
  });
}

test("Electron sidebar keeps project lists expanded and opens rules without switching draft identity", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("sidebar-expansion-a.html");
  const projectB = createSourceFixture("sidebar-expansion-b.html");
  const projectC = createSourceFixture(
    "sidebar-expansion-c-with-a-very-long-file-name-for-tooltip.html",
  );
  const launched = await launchStemmio({ activeSourcePath: projectA.sourcePath });
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await waitForProjectReady(launched.page);
    const managedAPath = await managedWorkingCopyPath(launched.page, projectA.sourcePath);
    const repository = new ProjectFileRepository({
      projectsRoot: path.dirname(path.dirname(managedAPath)),
    });
    for (const project of [projectB, projectC]) {
      const imported = await repository.importExternal({
        sourcePath: project.sourcePath,
        expectedSourceSha256: sha256(readFileSync(project.sourcePath)),
      });
      expect(imported.target.projectId).toMatch(/^project_[a-f0-9]{16,64}$/u);
      if (project === projectC) {
        let target = imported.target;
        for (const [ordinal, title] of [[2, "sidebar expansion V2"], [3, "sidebar expansion V3"]]) {
          const candidate = await repository.createCandidate({
            target,
            requestId: `req_sidebar_expansion_${ordinal}`,
            candidateId: `candidate_sidebar_expansion_${ordinal}_0001`,
            html: identityPreservingCandidateHtml(target, title),
            expectedSourceSha256: target.sourceSha256,
          });
          const promoted = await repository.promoteCandidate({
            target,
            candidateId: candidate.candidate.candidateId,
            decisionOperationId: `promote_${candidate.candidate.candidateId}`,
          });
          expect(promoted.promoted).toBe(true);
          target = promoted.target;
        }
      }
    }

    await launched.page.getByRole("button", { name: "展开左侧边栏" }).click();
    const sidebar = launched.page.locator(".workbench-global-sidebar");
    await expect(sidebar).toHaveAttribute("data-open", "true");
    await expect(sidebar.locator(".sidebar-project-section")).toHaveCount(1);
    await expect(sidebar.locator(".sidebar-project-item")).toHaveCount(3, {
      timeout: 30_000,
    });
    const currentProjectId = await launched.page.evaluate(async () => (
      (await window.stemmioProjects?.getActiveProject())?.projectId || null
    ));
    const currentProject = sidebar.locator(".sidebar-project-item")
      .filter({ hasText: "sidebar-expansion-a" })
      .first();
    const currentRow = currentProject.locator(".sidebar-project-row");
    await expect(currentRow).toHaveAttribute("aria-expanded", "true");

    const importedProject = (fileName) => sidebar.locator(".sidebar-project-item")
      .filter({ hasText: path.basename(fileName, path.extname(fileName)) })
      .first();
    const projectBRow = importedProject(projectB.sourcePath).locator(".sidebar-project-row");
    const projectCContainer = importedProject(projectC.sourcePath);
    const projectCRow = projectCContainer.locator(".sidebar-project-row");
    await expect(projectBRow).toBeVisible();
    await expect(projectCRow).toBeVisible();

    await projectBRow.click();
    await expect(projectBRow).toHaveAttribute("aria-expanded", "true");
    await expect(importedProject(projectB.sourcePath).locator(".sidebar-project-history-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(importedProject(projectB.sourcePath).locator(".sidebar-version-file")).toHaveCount(0);
    await importedProject(projectB.sourcePath).locator(".sidebar-project-history-toggle").click();
    await expect(importedProject(projectB.sourcePath).locator(".sidebar-version-file"))
      .toHaveCount(1, { timeout: 30_000 });
    expect(await launched.page.evaluate(async () => (
      (await window.stemmioProjects?.getActiveProject())?.projectId || null
    ))).toBe(currentProjectId);

    await projectCRow.click();
    await expect(projectCRow).toHaveAttribute("aria-expanded", "true");
    await expect(importedProject(projectB.sourcePath).locator(".sidebar-project-row"))
      .toHaveAttribute("aria-expanded", "true");
    await expect(projectCContainer.locator(".sidebar-project-history-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(projectCContainer.locator(".sidebar-version-file")).toHaveCount(0);
    await projectCContainer.locator(".sidebar-project-history-toggle").click();
    await expect(projectCContainer.locator(".sidebar-version-file"))
      .toHaveCount(3, { timeout: 30_000 });
    const firstHistory = projectCContainer.getByRole("button", { name: "V1，历史版本", exact: true });
    await expect(firstHistory).toHaveText(/V1/u);
    await expect(firstHistory).toHaveAttribute("title", /sidebar-expansion-c-with-a-very-long-file-name-for-tooltip.*\.html/u);

    await projectBRow.click();
    await expect(projectBRow).toHaveAttribute("aria-expanded", "false");
    await expect(projectCRow).toHaveAttribute("aria-expanded", "true");
    expect(await launched.page.evaluate(async () => (
      (await window.stemmioProjects?.getActiveProject())?.projectId || null
    ))).toBe(currentProjectId);

    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    await projectBRow.click();
    await expect(projectBRow).toHaveAttribute("aria-expanded", "true");
    const projectBRules = importedProject(projectB.sourcePath)
      .locator(".sidebar-project-rules-row");
    await projectBRules.click();
    const projectBRulesTab = launched.page.locator('.workbench-tab[data-kind="project-rules"]')
      .getByRole("tab", { name: "sidebar-expansion-b · 长期规则", exact: true });
    await expect(projectBRulesTab).toHaveAttribute("aria-selected", "true", {
      timeout: 60_000,
    });
    await expect(launched.page.getByRole("textbox", { name: "长期规则内容" }))
      .toBeVisible();
    await expect(projectBRules).toHaveAttribute("data-selected", "true");
    await expect(launched.page.locator('.workbench-tab[data-kind="document"]'))
      .toHaveCount(1);
    expect(await launched.page.evaluate(async () => (
      (await window.stemmioProjects?.getActiveProject())?.projectId || null
    ))).toBe(currentProjectId);

    await currentProject.locator(".sidebar-project-current-row").click();
    await expect(launched.page.locator('.workbench-tab[data-kind="document"]')
      .getByRole("tab", { name: "sidebar-expansion-a · 当前稿", exact: true }))
      .toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");

    const versionVisualFacts = await projectCContainer.locator(".sidebar-version-tree")
      .evaluate((tree) => ({
        fileIcons: tree.querySelectorAll(".sidebar-version-file > svg").length,
        currentLabels: tree.querySelectorAll(".sidebar-version-current-label").length,
        ordinals: [...tree.querySelectorAll(".sidebar-version-index")].map((element) => element.textContent),
      }));
    expect(versionVisualFacts.fileIcons).toBe(0);
    expect(versionVisualFacts.currentLabels).toBe(0);
    expect(versionVisualFacts.ordinals).toEqual(["V1", "V2", "V3"]);

    await projectCContainer.locator(".sidebar-project-current-row").click();
    await expect(tabs.filter({ hasText: "sidebar-expansion-c-with-a-very-long-file-name-for-tooltip" }))
      .toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await expect(currentRow)
      .toHaveAttribute("aria-expanded", "true");
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
    removeSourceFixture(projectC.sourceDirectory);
  }
});


for (const recoveryCase of ["pending", "rename", "superseded"]) {
  test(`Electron historical creation restart lifecycle: ${recoveryCase}`, {
    tag: ["@gate-smoke", "@smoke-project-lifecycle", "@smoke-version-display"],
  }, async () => {
    test.setTimeout(180_000);
    const fixture = createSourceFixture(`history-restart-${recoveryCase}.html`);
    let app = await launchStemmio({ activeSourcePath: fixture.sourcePath });
    const userData = app.isolatedUserData;
    try {
      await loadedDiskFrame(app.page, fixture.sourcePath, "list-item");
      const initialPath = await managedWorkingCopyPath(app.page, fixture.sourcePath);
      const repository = new ProjectFileRepository({ projectsRoot: path.dirname(path.dirname(initialPath)) });
      let target = (await repository.workspace({ sourcePath: initialPath })).target;
      await closeStemmioGracefully(app.electronApp, app.page);
      app = null;
      for (let ordinal = 2; ordinal <= 8; ordinal += 1) {
        const candidate = await repository.createCandidate({ target, requestId: `req_restart_${ordinal}`,
          candidateId: `candidate_restart_${ordinal}_0001`, html: identityPreservingCandidateHtml(target, `Restart V${ordinal}`),
          expectedSourceSha256: target.sourceSha256 });
        target = (await repository.promoteCandidate({ target, candidateId: candidate.candidate.candidateId, decisionOperationId: `promote_${candidate.candidate.candidateId}` })).target;
      }
      app = await launchStemmio({ isolatedUserData: userData, activeSourcePath: target.exactSourcePath });
      await waitForProjectReady(app.page);
      const mode = app.page.getByRole("group", { name: "工作模式", exact: true });
      await app.page.getByRole("button", { name: "展开左侧边栏", exact: true }).click();
      // History is a separate, initially collapsed list of immutable snapshots.
      const summary = await repository.listRegisteredProjectVersionSummaries({ projectId: target.projectId });
      const historical = summary.versions.find((entry) => entry.ordinal === 3);
      await app.page.locator(".sidebar-project-history-toggle").click();
      await app.page.getByRole("button", { name: `V${historical.ordinal}，历史版本`, exact: true }).click();
      await expect(mode).toHaveAttribute("data-view-label", "历史");
      let operationId;
      await app.page.route("**/history-version/create", async (route) => {
        operationId = route.request().postDataJSON().operationId;
        await route.fetch();
        await route.abort("failed");
      });
      await app.page.route("**/history-version/opened", (route) => route.abort("failed"));
      if (recoveryCase === "pending") await app.page.route("**/workspace?*", async (route) => {
        if (operationId && new URL(route.request().url()).searchParams.get("sourcePath") === target.exactSourcePath) {
          await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "TEST_PENDING", message: "尚未打开新稿" } }) });
        } else await route.continue();
      });
      await expect(mode.getByRole("button", { name: "编辑", exact: true })).toBeDisabled();
      await app.page.getByRole("button", { name: "更多", exact: true }).click();
      await app.page.getByRole("menuitem", { name: "基于此版本创建新版本…", exact: true }).click();
      await confirmHistoryCreation(app.page);
      await expect.poll(() => operationId).toMatch(/^history_[A-Za-z0-9-]+$/u);
      if (recoveryCase === "pending") await expect(app.page.getByRole("button", { name: "打开已创建版本", exact: true })).toBeEnabled();
      else {
        // Creating and validating the immutable V9 snapshot performs real
        // filesystem work. Under the full Electron gate it can legitimately
        // exceed Playwright's 10 s assertion default, while the product
        // contract here is eventual authority handoff rather than a 10 s SLA.
        await expect(mode).toHaveAttribute("data-view-label", "当前", { timeout: 60_000 });
        await expect(app.page.getByRole("tab", { selected: true }))
          .toHaveAccessibleName(currentProjectTabName(initialPath), { timeout: 60_000 });
        // The selected tab is published before the navigation owner releases
        // its close guard. Wait for the public toolbar boundary before restart.
        await expect(mode.getByRole("button", { name: "编辑", exact: true })).toBeEnabled({ timeout: 60_000 });
      }
      const receipt = await repository.queryHistoryCreation({ target, operationId });
      expect(receipt.versionId).toBe("ver_0009");
      expect(receipt.openedAt).toBeNull();
      let expectedPath = receipt.sourcePath;
      if (recoveryCase === "superseded") {
        const current = (await repository.workspace({ sourcePath: receipt.sourcePath })).target;
        const candidate = await repository.createCandidate({ target: current, requestId: "req_restart_next",
          candidateId: "candidate_restart_next_0001", html: identityPreservingCandidateHtml(current, "Restart V10"),
          expectedSourceSha256: current.sourceSha256 });
        const next = await repository.promoteCandidate({ target: current, candidateId: candidate.candidate.candidateId, decisionOperationId: `promote_${candidate.candidate.candidateId}` });
        expectedPath = next.target.exactSourcePath;
        expect((await repository.queryHistoryCreation({ target: next.target, operationId })).recoveryState).toBe("superseded");
      }
      if (recoveryCase === "pending") {
        // The simulated workspace outage also prevents verifying the replaced
        // current file for graceful close. Exercise crash recovery while keeping
        // that protection and the unopened history receipt intact.
        await stopStemmio(app.electronApp, userData, { cleanup: false });
      } else {
        // The first renderer intentionally loses the opened acknowledgement;
        // the restarted renderer is a fresh client and must be allowed to
        // retry the current endpoint.
        await app.page.unroute("**/history-version/opened");
        await closeStemmioGracefully(app.electronApp, app.page);
      }
      app = null;
      if (recoveryCase === "rename") {
        const renamed = path.join(target.projectRootPath, "renamed-history.html");
        renameSync(expectedPath, renamed);
        // Renaming the managed source changes the current project identity
        // boundary.  Re-resolve the target instead of querying with the
        // pre-rename path and relying on the retired legacy rebinding path.
        target = (await repository.workspace({ sourcePath: renamed })).target;
        expectedPath = renamed;
      }
      // The pending case intentionally uses the existing persisted tab. For
      // a later AI promotion, seed its selected working file as the open target.
      app = await launchStemmio({ isolatedUserData: userData,
        ...(recoveryCase === "superseded" ? { activeSourcePath: expectedPath } : {}) });
      await waitForProjectReady(app.page);
      await expect(app.page.getByRole("tab", { selected: true }))
        .toHaveAccessibleName(currentProjectTabName(expectedPath), { timeout: 60_000 });
      if (recoveryCase === "superseded") {
        // Persist the selected V10, then exercise an ordinary restart without
        // a command-line target. The V9 acknowledgment is still missing.
        await closeStemmioGracefully(app.electronApp, app.page);
        app = null;
        app = await launchStemmio({ isolatedUserData: userData });
        await waitForProjectReady(app.page);
        await expect(app.page.getByRole("tab", { selected: true }))
          .toHaveAccessibleName(currentProjectTabName(expectedPath));
      }
      await expect(app.page.getByText("创建结果暂时未知", { exact: true })).toHaveCount(0);
      const restored = await repository.queryHistoryCreation({ target, operationId });
      expect(restored.versionId).toBe("ver_0009");
      const versions = await repository.listRegisteredProjectVersionSummaries({ projectId: target.projectId });
      expect(versions.versions).toHaveLength(recoveryCase === "superseded" ? 10 : 9);
      if (recoveryCase === "superseded") {
        expect(restored.recoveryState).toBe("superseded");
        await expect(app.page.getByRole("button", { name: "打开已创建版本", exact: true })).toHaveCount(0);
      } else {
        // Restart recovery verifies and acknowledges the current Canvas after
        // the new Electron process is ready; allow that durable acknowledgement
        // the same eventual boundary used by the visible current-mode checks.
        await expect.poll(
          async () => (await repository.queryHistoryCreation({ target, operationId })).openedAt,
          { timeout: 60_000 },
        ).not.toBeNull();
      }
      await app.page.getByRole("button", { name: "展开左侧边栏", exact: true }).click();
      await app.page.locator(".sidebar-project-history-toggle").click();
      const restoredMode = app.page.getByRole("group", { name: "工作模式", exact: true });
      await expect(restoredMode.getByRole("button", { name: "编辑", exact: true })).toBeEnabled();
      await app.page.getByRole("button", { name: `V${historical.ordinal}，历史版本`, exact: true }).click();
      await expect(restoredMode).toHaveAttribute("data-view-label", "历史");
      await expect(restoredMode.getByRole("button", { name: "编辑", exact: true })).toBeDisabled();
      await app.page.getByRole("button", { name: "更多", exact: true }).click();
      await app.page.getByRole("menuitem", { name: "基于此版本创建新版本…", exact: true }).click();
      await expect(app.page.getByRole("dialog", { name: /创建新版本/ })).toBeVisible();
      await app.page.getByRole("dialog").getByRole("button", { name: "取消", exact: true }).click();
    } finally {
      if (app) await stopStemmio(app.electronApp, userData);
      else removeIsolatedUserData(userData);
      removeSourceFixture(fixture.sourceDirectory);
    }
  });
}

test("Electron local current draft saves immutable versions and exports with an optional snapshot", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle", "@smoke-version-display"],
}, async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("local-current-draft.html");
  const launched = await launchStemmio({ activeSourcePath: fixture.sourcePath });
  try {
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const currentPath = await managedWorkingCopyPath(launched.page, fixture.sourcePath);
    const repository = new ProjectFileRepository({ projectsRoot: path.dirname(path.dirname(currentPath)) });
    const initial = (await repository.workspace({ sourcePath: currentPath })).target;
    const versionOne = await repository.readVersionFile({ target: initial, versionId: "ver_0001" });
    const versions = async () => (await repository.listRegisteredProjectVersionSummaries({ projectId: initial.projectId })).versions;
    const mode = launched.page.getByRole("group", { name: "工作模式", exact: true });
    const more = launched.page.getByRole("button", { name: "更多", exact: true });
    const workbench = launched.page.locator("main.workbench");
    const currentIdentity = () => repository.workspace({ sourcePath: currentPath }).then(({ target }) => ({
      projectId: target.projectId, documentId: target.documentId,
      workingCopyId: target.workingCopyId, exactSourcePath: target.exactSourcePath,
    }));
    const identity = await currentIdentity();
    await more.click();
    await launched.page.getByRole("menuitem", { name: "找回此前的稿件…", exact: true }).click();
    const recoveryDialog = launched.page.getByRole("dialog", { name: "找回此前的稿件", exact: true });
    await expect(recoveryDialog).toContainText("暂无需要找回的稿件。");
    await launched.page.screenshot({ path: test.info().outputPath("preserved-drafts-empty.png") });
    await launched.page.mouse.click(400, 12);
    await expect(recoveryDialog).toHaveCount(0);

    const preservedDraft = {
      recoveryId: "recovery_test_0001",
      originalWorkingCopyId: initial.workingCopyId,
      basedOnVersionId: "ver_0001",
      sourceSha256: initial.sourceSha256,
      createdAt: "2026-08-12T00:00:00.000Z",
      reason: "working-copy-replaced",
      hasComments: true,
      attachmentCount: 0,
    };
    let preservedDraftLoads = 0;
    let releaseFirstPreservedDraftLoad;
    await launched.page.route("**/preserved-drafts?*", async (route) => {
      preservedDraftLoads += 1;
      if (preservedDraftLoads === 1) {
        await new Promise((resolve) => { releaseFirstPreservedDraftLoad = resolve; });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ ok: true, projectId: initial.projectId, drafts: [] }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ok: true, projectId: initial.projectId, drafts: [preservedDraft] }),
      });
    });
    await more.click();
    await launched.page.getByRole("menuitem", { name: "找回此前的稿件…", exact: true }).click();
    await expect(recoveryDialog.getByRole("status")).toHaveText("正在读取…");
    await expect.poll(() => preservedDraftLoads).toBe(1);
    await recoveryDialog.getByRole("button", { name: "关闭", exact: true }).click();
    await expect(recoveryDialog).toHaveCount(0);
    await more.click();
    await launched.page.getByRole("menuitem", { name: "找回此前的稿件…", exact: true }).click();
    await expect(recoveryDialog.getByRole("button", { name: "恢复为当前稿", exact: true })).toBeEnabled();
    releaseFirstPreservedDraftLoad();
    await launched.page.waitForTimeout(150);
    await expect(recoveryDialog).toBeVisible();
    await expect(recoveryDialog.getByRole("button", { name: "恢复为当前稿", exact: true })).toBeEnabled();
    await expect(recoveryDialog.getByText("暂无需要找回的稿件。", { exact: true })).toHaveCount(0);
    await recoveryDialog.getByRole("button", { name: "关闭", exact: true }).click();
    await launched.page.unroute("**/preserved-drafts?*");
    const editCurrent = async (marker) => {
      const { frame } = await loadedStaticDiskFrame(launched.page, currentPath, { expectedCase: "list-item", includeEditor: true });
      const beforeRevision = Number(await launched.page.locator("[data-persist-state]").first().getAttribute("data-edit-revision"));
      await activateNativeEdit(frame, "list-item");
      await setTextSelection(frame, "list-item", 0, 3);
      await launched.page.keyboard.insertText(marker);
      await launched.page.keyboard.press(keyShortcut("S"));
      await expectCheckpointPersisted(launched.page, beforeRevision);
      const persisted = await readPublishedWorkingCopy(currentPath);
      expect(persisted).toContain(marker);
      return persisted;
    };
    const firstEdit = await editCurrent("LOCAL_SNAPSHOT_ONE");
    await more.click();
    await launched.page.getByRole("menuitem", { name: "保存为新版本", exact: true }).click();
    await expect.poll(async () => (await versions()).length).toBe(2);
    await expect(launched.page.locator(".current-draft-result")).toContainText("已保存 V2");
    expect(await currentIdentity()).toEqual(identity);
    const afterSave = (await repository.workspace({ sourcePath: currentPath })).target;
    expect(afterSave.versionId).toBe("ver_0002");
    expect((await repository.readVersionFile({ target: afterSave, versionId: "ver_0001" })).content).toBe(versionOne.content);
    const versionTwo = await repository.readVersionFile({ target: afterSave, versionId: "ver_0002" });
    expect(versionTwo.content).toBe(firstEdit);

    await launched.page.getByRole("button", { name: "展开左侧边栏", exact: true }).click();
    const project = launched.page.locator(".sidebar-project-item").filter({ hasText: "local-current-draft" });
    const current = project.locator(".sidebar-project-current-row");
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(project.locator(".sidebar-project-history-toggle")).toHaveAttribute("aria-expanded", "false");
    await expect(project.locator(".sidebar-version-file")).toHaveCount(0);
    await expect.poll(() => launched.page.evaluate(() => {
      const result = document.querySelector(".current-draft-result").getBoundingClientRect();
      const header = document.querySelector(".workbench-header").getBoundingClientRect();
      const stage = document.querySelector(".review-scroll-stage").getBoundingClientRect();
      return result.x >= 200 && result.x === header.x
        && result.y >= header.bottom && stage.y >= result.bottom;
    })).toBe(true);
    await launched.page.screenshot({ path: test.info().outputPath("current-draft-sidebar.png") });
    await project.locator(".sidebar-project-history-toggle").click();
    await expect(project.locator(".sidebar-version-index")).toHaveText(["V1", "V2"]);
    await project.getByRole("button", { name: "V1，历史版本", exact: true }).click();
    await expect(mode).toHaveAttribute("data-view-label", "历史");
    const preview = launched.page.frameLocator('iframe[title="HTML 交互预览"]');
    await expect(preview.locator(caseSelector("list-item"))).not.toContainText("LOCAL_SNAPSHOT_ONE");
    await expect(current).not.toHaveAttribute("aria-current", "page");
    await project.getByRole("button", { name: "V2，历史版本", exact: true }).click();
    await expect(preview.locator(caseSelector("list-item"))).toContainText("LOCAL_SNAPSHOT_ONE");
    await expect(mode).toHaveAttribute("data-view-label", "历史");
    expect(readFileSync(currentPath, "utf8")).toBe(firstEdit);
    await launched.page.screenshot({ path: test.info().outputPath("immutable-history.png") });
    await current.click();
    await expect(mode).toHaveAttribute("data-view-label", "当前");
    await expect(current).toHaveAttribute("aria-current", "page");
    await expect(project.locator('.sidebar-version-row[data-selected="true"]')).toHaveCount(0);
    let secondEdit = await editCurrent("LOCAL_EXPORT_TWO");

    await interceptExternalBrowserOpen(launched.electronApp);
    const pendingBrowserFrame = await loadedStaticDiskFrame(
      launched.page,
      currentPath,
      { expectedCase: "list-item", includeEditor: true },
    );
    await activateNativeEdit(pendingBrowserFrame.frame, "list-item");
    await setTextSelection(pendingBrowserFrame.frame, "list-item", 0, 3);
    await launched.page.keyboard.insertText("BROWSER_NATIVE_INPUT");
    await more.click();
    await launched.page.getByRole("menuitem", {
      name: "在浏览器中打开工作文件",
      exact: true,
    }).click();
    await expect.poll(() => openedExternalUrls(launched.electronApp)).toEqual([
      pathToFileURL(identity.exactSourcePath).href,
    ]);
    await expect.poll(() => readFileSync(currentPath, "utf8")).toContain(
      "BROWSER_NATIVE_INPUT",
    );
    secondEdit = readFileSync(currentPath, "utf8");

    const exportPath = path.join(fixture.sourceDirectory, "exported-current.html");
    await launched.electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, exportPath);
    const exportCheckbox = launched.page.getByRole("menuitemcheckbox", { name: "同时保存为新版本", exact: true });
    const exportMenuItem = launched.page.getByRole("menuitem", { name: "导出当前 HTML…", exact: true });
    await more.click();
    await expect(exportCheckbox).toHaveAttribute("aria-checked", "false");
    await launched.page.screenshot({ path: test.info().outputPath("current-draft-export-menu.png") });
    await exportMenuItem.click();
    await expect(workbench).toHaveAttribute("data-html-export-state", "exported");
    await expect.poll(() => { try { return readFileSync(exportPath, "utf8"); } catch { return null; } }).toBe(secondEdit);
    expect(await versions()).toHaveLength(2);
    await more.click();
    await expect(exportCheckbox).toHaveAttribute("aria-checked", "false");
    await exportCheckbox.click();
    await expect(exportCheckbox).toHaveAttribute("aria-checked", "true");
    await exportMenuItem.click();
    await expect(workbench).toHaveAttribute("data-html-export-state", "exported");
    await expect.poll(async () => (await versions()).length).toBe(3);
    expect(readFileSync(exportPath, "utf8")).toBe(secondEdit);
    expect(await currentIdentity()).toEqual(identity);
    const exportedTarget = (await repository.workspace({ sourcePath: currentPath })).target;
    expect(exportedTarget.versionId).toBe("ver_0003");
    expect((await repository.readVersionFile({ target: exportedTarget, versionId: "ver_0003" })).content).toBe(secondEdit);
    expect((await repository.readVersionFile({ target: exportedTarget, versionId: "ver_0002" })).content).toBe(firstEdit);

    await more.click();
    await expect(exportCheckbox).toHaveAttribute("aria-checked", "false");
    await exportCheckbox.click();
    await exportMenuItem.click();
    await expect(workbench).toHaveAttribute("data-html-export-state", "exported");
    await expect(launched.page.locator(".current-draft-result")).toContainText("HTML 已导出");
    await expect(exportMenuItem).toHaveCount(0);
    expect(await versions()).toHaveLength(3);
    await launched.electronApp.evaluate(({ dialog }) => {
      dialog.showSaveDialog = async () => ({ canceled: true });
    });
    await editCurrent("LOCAL_CANCEL_THREE");
    await more.click();
    await expect(exportCheckbox).toHaveAttribute("aria-checked", "false");
    await exportCheckbox.click();
    await exportMenuItem.click();
    await expect(exportMenuItem).toHaveCount(0);
    await expect(workbench).toHaveAttribute("data-html-export-state", "cancelled");
    expect(await versions()).toHaveLength(3);
    const currentBeforeFailedExport = readFileSync(currentPath, "utf8");
    await launched.electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, currentPath);
    await more.click();
    await expect(exportCheckbox).toHaveAttribute("aria-checked", "false");
    await exportCheckbox.click();
    await exportMenuItem.click();
    await expect(workbench).toHaveAttribute("data-html-export-state", "failed");
    expect(await versions()).toHaveLength(3);
    expect(readFileSync(currentPath, "utf8")).toBe(currentBeforeFailedExport);
    expect(readFileSync(exportPath, "utf8")).toBe(secondEdit);
    expect(readFileSync(fixture.sourcePath, "utf8")).toBe(versionOne.content);
    expect(await currentIdentity()).toEqual(identity);
  } finally {
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

for (const barrier of ["none", "create", "close"]) {
  test(`Electron held B navigation settles every C/D intent across ${barrier} barrier`, {
    tag: ["@gate-smoke", "@smoke-project-lifecycle"],
  }, async () => {
    test.setTimeout(180_000);
    const projects = ["a", "b", "c", "d"].map((id) => (
      createSourceFixture(`navigation-intent-${id}.html`)
    ));
    const [a, b, c, d] = projects;
    const launched = await launchStemmio({ activeSourcePath: a.sourcePath });
    let releaseB;
    let heldB = false;
    const requests = [];
    const hold = async (route) => {
      const url = new URL(route.request().url());
      requests.push({
        source: path.basename(url.searchParams.get("sourcePath") || ""),
        path: url.searchParams.get("path"),
      });
      if (!heldB) {
        heldB = true;
        await new Promise((resolve) => { releaseB = resolve; });
      }
      await route.continue();
    };
    try {
      await loadedDiskFrame(launched.page, a.sourcePath, "list-item");
      const managedA = await managedWorkingCopyPath(launched.page, a.sourcePath);
      const repository = new ProjectFileRepository({
        projectsRoot: path.dirname(path.dirname(managedA)),
      });
      for (const project of [b, c, d]) {
        await repository.importExternal({
          sourcePath: project.sourcePath,
          expectedSourceSha256: sha256(readFileSync(project.sourcePath)),
        });
      }
      await launched.page.getByRole("button", { name: "展开左侧边栏" }).click();
      const sidebar = launched.page.locator(".workbench-global-sidebar");
      const item = (project) => sidebar.locator(".sidebar-project-item").filter({
        hasText: path.basename(project.sourcePath, ".html"),
      }).first();
      const expand = async (project) => {
        const row = item(project).locator(".sidebar-project-row");
        if (await row.getAttribute("aria-expanded") !== "true") await row.click();
      };
      const rulesTab = (project) => launched.page.getByRole("tab", {
        name: `${path.basename(project.sourcePath, ".html")} · 长期规则`, exact: true,
      });
      for (const project of [c, d]) {
        await expand(project);
        await item(project).locator(".sidebar-project-rules-row").click();
        await expect(rulesTab(project)).toHaveAttribute("aria-selected", "true");
        await expect(launched.page.getByRole("textbox", { name: "长期规则内容" })).toBeVisible();
      }
      await item(a).locator(".sidebar-project-current-row").click();
      await loadedDiskFrame(launched.page, a.sourcePath, "list-item");
      const tabA = launched.page.getByRole("tab", { name: "navigation-intent-a · 当前稿", exact: true });
      const tabAId = String(await tabA.getAttribute("id")).replace(/^workbench-tab-/u, "");
      const tabCId = String(await rulesTab(c).getAttribute("id")).replace(/^workbench-tab-/u, "");
      const tabDId = String(await rulesTab(d).getAttribute("id")).replace(/^workbench-tab-/u, "");
      await expand(b);

      // Observe the real command promises without replacing navigation or its
      // outcomes. The UI clicks below still enter through the React handlers.
      // React access is test-local, as in the saved iframe-handler tests above.
      await launched.page.evaluate(() => {
        const main = document.querySelector('main.workbench');
        const key = Object.keys(main).find((name) => name.startsWith("__reactFiber$"));
        let fiber = main[key];
        let controller;
        while (fiber && !controller) {
          let hook = fiber.memoizedState;
          while (hook && !controller) {
            const value = hook.memoizedState;
            if (value && typeof value.activateWorkbenchTab === "function"
              && typeof value.getSnapshot === "function") controller = value;
            hook = hook.next;
          }
          fiber = fiber.return;
        }
        if (!controller) throw new Error("Navigation Controller was not mounted");
        const records = [];
        const originals = new Map();
        for (const method of ["activateWorkbenchTab", "createWorkbenchProjectRulesTab", "createWorkbenchStartTab", "closeWorkbenchTab"]) {
          const original = controller[method];
          originals.set(method, original);
          controller[method] = function observeNavigation(...args) {
            const record = { method, target: args[0]?.projectId || args[0] || null, terminal: false };
            records.push(record);
            const result = original.apply(this, args);
            Promise.resolve(result).then((outcome) => {
              record.outcome = outcome;
              record.terminal = true;
            }, (error) => {
              record.error = String(error);
              record.terminal = true;
            });
            return result;
          };
        }
        window.__STEMMIO_TEST_NAVIGATION_OBSERVER__ = {
          records,
          snapshot: () => controller.navigation.getSnapshot(),
          restore: () => {
            for (const [method, original] of originals) controller[method] = original;
          },
        };
      });
      await launched.page.route("**/file?*", hold);
      await item(b).locator(".sidebar-project-rules-row").click();
      await expect.poll(() => heldB).toBe(true);
      const pendingRulesTab = launched.page.locator('.workbench-tab[data-kind="project-rules"][data-pending="true"]');
      await expect(pendingRulesTab).toHaveCount(1);
      await expect(pendingRulesTab.getByRole("tab")).toHaveAttribute("aria-label", "navigation-intent-b · 长期规则，正在打开");
      await expect(pendingRulesTab.getByRole("tab")).toHaveAttribute("aria-busy", "true");
      await expect(pendingRulesTab.getByRole("tab")).toHaveAttribute("aria-selected", "false");
      await expect(tabA).toHaveAttribute("aria-selected", "true");
      const openingStyle = await pendingRulesTab.evaluate((element) => {
        const tab = getComputedStyle(element);
        const underline = getComputedStyle(element, "::after");
        return { background: tab.backgroundColor, line: underline.backgroundColor,
          lineHeight: underline.height, content: underline.content };
      });
      expect(openingStyle.background).not.toBe("rgba(0, 0, 0, 0)");
      expect(openingStyle.line).not.toBe("rgba(0, 0, 0, 0)");
      expect(openingStyle.lineHeight).toBe("2px");
      expect(openingStyle.content).toBe('""');
      if (barrier === "none") {
        await launched.page.screenshot({ path: test.info().outputPath("rules-tab-opening.png") });
      }
      await rulesTab(c).click();
      if (barrier === "create") await launched.page.getByRole("button", { name: "新标签页", exact: true }).click();
      if (barrier === "close") await launched.page.getByRole("button", { name: "关闭 navigation-intent-a · 当前稿", exact: true }).click();
      await rulesTab(d).click();
      expect(requests).toEqual([{ source: "navigation-intent-b.html", path: "PROJECT.md" }]);
      const expectedCommandCount = barrier === "none" ? 3 : 4;
      const records = () => launched.page.evaluate(() => (
        window.__STEMMIO_TEST_NAVIGATION_OBSERVER__.records
      ));
      await expect.poll(async () => (await records()).length).toBe(expectedCommandCount);
      expect((await records()).every((record) => record.terminal === false)).toBe(true);
      releaseB();
      await expect.poll(async () => (await records()).filter((record) => record.terminal).length)
        .toBe(expectedCommandCount);
      const settled = await records();
      expect(settled.every((record) => !record.error && record.outcome.status === "succeeded")).toBe(true);
      const cOutcome = settled.find((record) => record.target === tabCId).outcome;
      if (barrier === "none") {
        expect(cOutcome.value).toMatchObject({ activated: false, superseded: true, supersededByTabId: tabDId });
      } else {
        expect(cOutcome.value.superseded).not.toBe(true);
      }
      const expectedSources = barrier === "none" ? ["b", "d"] : ["b", "c", "d"];
      expect(requests).toEqual(expectedSources.map((id) => ({
        source: `navigation-intent-${id}.html`, path: "PROJECT.md",
      })));
      await expect(rulesTab(d)).toHaveAttribute("aria-selected", "true");
      await expect(launched.page.locator('.workbench-tab[data-pending="true"]')).toHaveCount(0);
      await expect(rulesTab(d)).not.toHaveAttribute("aria-busy", "true");
      await expect(launched.page.getByRole("textbox", { name: "长期规则内容" })).toBeVisible();
      await expect.poll(() => launched.page.evaluate(() => {
        const snapshot = window.__STEMMIO_TEST_NAVIGATION_OBSERVER__.snapshot();
        return { phase: snapshot.workflow.phase, active: snapshot.tabs.activeTabId,
          mounted: snapshot.tabs.mountedDocumentTabId, runtime: snapshot.tabs.runtimeOwnerTabId };
      })).toEqual({ phase: "idle", active: tabDId, mounted: null, runtime: barrier === "close" ? null : tabAId });
      await expect(launched.page.getByRole("tab")).toHaveCount(barrier === "create" ? 5 : barrier === "close" ? 3 : 4);
    } finally {
      releaseB?.();
      await launched.page.unroute("**/file?*", hold).catch(() => {});
      await launched.page.evaluate(() => {
        window.__STEMMIO_TEST_NAVIGATION_OBSERVER__?.restore();
        delete window.__STEMMIO_TEST_NAVIGATION_OBSERVER__;
      }).catch(() => {});
      await stopStemmio(launched.electronApp, launched.isolatedUserData);
      for (const project of projects) removeSourceFixture(project.sourceDirectory);
    }
  });
}

test("Electron replaces the outgoing Canvas after same-source hydration advances authority", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  const projectA = createSourceFixture("cache-authority-a.html");
  const projectB = createSourceFixture("cache-authority-b.html");
  const original = readFileSync(projectA.sourcePath, "utf8");
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
  });
  try {
    const initial = await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    const priorText = await initial.frame.locator(caseSelector("list-item")).textContent();
    await activateNativeEdit(initial.frame, "list-item");
    await setTextSelection(initial.frame, "list-item", 0, priorText.length);
    await launched.page.keyboard.insertText("快速切换仍然安全写回");
    await expect(initial.frame.locator(caseSelector("list-item"))).toHaveText("快速切换仍然安全写回");
    const workingPath = await managedWorkingCopyPath(launched.page, projectA.sourcePath);
    await openRecentProject(launched.page, projectB.sourcePath);
    await holdCanvasLoads(launched.page);
    const openPromise = openRecentProject(
      launched.page, workingPath, "list-item", path.basename(projectA.sourcePath),
    );
    // Preserve the navigation error while the controlled Canvas load is held.
    openPromise.catch(() => {});
    // Wait for the real hydration publication, not a timer or a fabricated ACK.
    await expect.poll(() => launched.page.evaluate(() => {
      const main = document.querySelector("main.workbench");
      let fiber = main[Object.keys(main).find((key) => key.startsWith("__reactFiber$"))];
      let controller;
      while (fiber && !controller) {
        let hook = fiber.memoizedState;
        while (hook && !controller) {
          const value = hook.memoizedState;
          if (value && typeof value.activateWorkbenchTab === "function") controller = value;
          hook = hook.next;
        }
        fiber = fiber.return;
      }
      if (!controller) throw new Error("Controller unavailable");
      const snapshot = controller.getSnapshot();
      const navigation = snapshot.workbenchNavigation;
      const initial = navigation.lastReceipt?.sourceReceipt;
      const current = snapshot.document.sourceReceipt;
      return Boolean(initial && current
        && navigation.phase === "idle" && !snapshot.workbenchTabs.pendingTabId
        && current.sequence > initial.sequence
        && current.canvasGeneration > initial.canvasGeneration
        && current.sourceSha256 === initial.sourceSha256
        && current.context.epoch === initial.context.epoch
        && snapshot.document.canvasAuthority.status === "pending"
        && typeof window.__STEMMIO_TEST_DELAYED_CANVAS_ON_LOAD__ === "function");
    })).toBe(true);
    await expect(launched.page.locator("[data-outgoing-draft]")).toBeVisible();
    await expect(launched.page.locator("[data-outgoing-draft]")).toHaveAttribute("inert", "");
    await launched.page.evaluate(() => {
      const onLoad = window.__STEMMIO_TEST_DELAYED_CANVAS_ON_LOAD__;
      const frame = window.__STEMMIO_TEST_DELAYED_CANVAS_FRAME__;
      if (typeof onLoad !== "function" || !(frame instanceof HTMLIFrameElement)) {
        throw new Error("Delayed Canvas ready callback unavailable");
      }
      window.__STEMMIO_TEST_BLOCK_CANVAS_LOAD__ = false;
      onLoad({ currentTarget: frame });
    });
    const { frame } = await openPromise;
    await expect(launched.page.locator("[data-outgoing-draft]")).toHaveCount(0);
    await expect(launched.page.getByTestId("html-canvas-editor")).toHaveCount(1);
    await expect(frame.locator(caseSelector("list-item"))).toHaveText("快速切换仍然安全写回");
    const beforeRevision = Number(await launched.page.locator("[data-persist-state]")
      .first().getAttribute("data-edit-revision"));
    await activateNativeEdit(frame, "list-item");
    await setTextSelection(frame, "list-item", 0, 3);
    await launched.page.keyboard.insertText("HANDOFF_EDIT_SAVED");
    await launched.page.keyboard.press(keyShortcut("S"));
    await expectCheckpointPersisted(launched.page, beforeRevision);
    expect(await readPublishedWorkingCopy(workingPath)).toContain("HANDOFF_EDIT_SAVED");
    expect(readFileSync(projectA.sourcePath, "utf8")).toBe(original);
  } finally {
    await releaseCanvasLoadHold(launched.page);
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

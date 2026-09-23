import { expect, test } from "@playwright/test";
import { pathToFileURL } from "node:url";
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

const cachedTabHandoffEnv = { STEMMIO_E2E_CACHED_TAB_HANDOFF: "1" };

test("Electron switches current drafts without a static tab-handoff iframe by default", {
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
    const surfaceCache = launched.page.getByTestId("workbench-document-surface-cache");
    await expect(surfaceCache).toHaveAttribute("data-cache-entry-count", "2");
    await launched.page.evaluate(() => {
      const root = document.querySelector('[data-testid="workbench-document-surface-cache"]');
      window.__STEMMIO_TEST_HANDOFF_MAX__ = root?.querySelectorAll("iframe").length || 0;
      const sample = () => {
        window.__STEMMIO_TEST_HANDOFF_MAX__ = Math.max(
          window.__STEMMIO_TEST_HANDOFF_MAX__ || 0,
          root?.querySelectorAll("iframe").length || 0,
        );
      };
      const observer = new MutationObserver(sample);
      if (root) observer.observe(root, { childList: true, subtree: true });
      window.__STEMMIO_TEST_HANDOFF_OBSERVER__ = observer;
    });
    await tabs.filter({ hasText: "direct-canvas-a" }).click();
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await tabs.filter({ hasText: "direct-canvas-b" }).click();
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    expect(await launched.page.evaluate(() => window.__STEMMIO_TEST_HANDOFF_MAX__ || 0)).toBe(0);
    await expect(surfaceCache).toHaveAttribute("data-mounted-count", "0");
    expect(await surfaceCache.getAttribute("data-visible")).toBeNull();
    await expect(surfaceCache.locator("iframe")).toHaveCount(0);
    const geometry = await launched.page.evaluate(() => ({
      canvas: document.querySelector(".review-scroll-stage .canvas-column")?.getBoundingClientRect().width || 0,
      rail: document.querySelector(".review-scroll-stage .comments-panel.comment-rail")?.getBoundingClientRect().width || 0,
    }));
    expect(geometry.canvas).toBeGreaterThan(0);
    expect(geometry.rail).toBeGreaterThan(0);
  } finally {
    await launched.page.evaluate(() => {
      window.__STEMMIO_TEST_HANDOFF_OBSERVER__?.disconnect();
      delete window.__STEMMIO_TEST_HANDOFF_OBSERVER__;
      delete window.__STEMMIO_TEST_HANDOFF_MAX__;
    }).catch(() => {});
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
    injectedEnv: cachedTabHandoffEnv,
  });
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await openRecentProject(launched.page, projectB.sourcePath);
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" });
    const tabA = tabs.getByRole("tab").filter({ hasText: "tab-width-a" });
    const tabB = tabs.getByRole("tab").filter({ hasText: "tab-width-b" });
    const surfaceCache = launched.page.getByTestId("workbench-document-surface-cache");
    await launched.page.evaluate(() => {
      const stage = document.querySelector(".review-scroll-stage");
      const canvas = stage?.querySelector(".canvas-column");
      const read = () => ({
        t: performance.now(),
        inspector: stage?.getAttribute("data-inspector"),
        stage: stage?.getBoundingClientRect().width || 0,
        canvas: canvas?.getBoundingClientRect().width || 0,
        rail: stage?.querySelector(".comments-panel.comment-rail")?.getBoundingClientRect().width || 0,
        cache: document.querySelector('[data-testid="workbench-document-surface-cache"]')?.getBoundingClientRect().width || 0,
        cacheVisible: document.querySelector('[data-testid="workbench-document-surface-cache"]')?.getAttribute("data-visible") || "false",
        selected: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent?.trim() || "",
      });
      window.__STEMMIO_TEST_TAB_WIDTH_TRACE__ = [read()];
      const sample = () => {
        window.__STEMMIO_TEST_TAB_WIDTH_TRACE__.push(read());
        window.__STEMMIO_TEST_TAB_WIDTH_RAF__ = requestAnimationFrame(sample);
      };
      window.__STEMMIO_TEST_TAB_WIDTH_RAF__ = requestAnimationFrame(sample);
    });
    await holdCacheAndCanvasLoads(launched.page);
    await tabA.click();
    await expect(surfaceCache).toHaveAttribute("data-visible", "true");
    const handoffGeometry = await launched.page.evaluate(() => {
      const stage = document.querySelector(".review-scroll-stage");
      const canvas = stage?.querySelector(".canvas-column");
      const cache = document.querySelector('[data-testid="workbench-document-surface-cache"]');
      const rail = stage?.querySelector(".comments-panel.comment-rail");
      return {
        inspector: stage?.getAttribute("data-inspector"),
        canvas: canvas?.getBoundingClientRect().width || 0,
        cache: cache?.getBoundingClientRect().width || 0,
        rail: rail?.getBoundingClientRect().width || 0,
      };
    });
    expect(handoffGeometry.inspector).toBe("comments");
    expect(handoffGeometry.rail).toBeGreaterThan(0);
    await launched.page.screenshot({ path: test.info().outputPath("cached-draft-with-comments.png") });
    expect(Math.abs(handoffGeometry.cache - handoffGeometry.canvas), JSON.stringify(handoffGeometry))
      .toBeLessThanOrEqual(2);
    await releaseCacheAndCanvasLoadHold(launched.page);
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
    await releaseCacheAndCanvasLoadHold(launched.page);
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

async function holdCacheAndCanvasLoads(page) {
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
      if (target.closest('[data-testid="workbench-document-surface-cache"]')) {
        if (!window.__STEMMIO_TEST_BLOCK_CACHE_LOAD__) return;
        window.__STEMMIO_TEST_DELAYED_CACHE_FRAME__ = target;
        window.__STEMMIO_TEST_DELAYED_CACHE_ON_LOAD__ = reactLoadHandler(target);
        event.stopImmediatePropagation();
        event.stopPropagation();
        return;
      }
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
    window.__STEMMIO_TEST_BLOCK_CACHE_LOAD__ = false;
    window.__STEMMIO_TEST_BLOCK_CANVAS_LOAD__ = true;
    window.__STEMMIO_TEST_HANDOFF_LOAD_CAPTURE__ = captureLoad;
    document.addEventListener("load", captureLoad, true);
  });
}

async function releaseCacheAndCanvasLoadHold(page) {
  await page.evaluate(() => {
    const captureLoad = window.__STEMMIO_TEST_HANDOFF_LOAD_CAPTURE__;
    if (captureLoad) document.removeEventListener("load", captureLoad, true);
    delete window.__STEMMIO_TEST_HANDOFF_LOAD_CAPTURE__;
    delete window.__STEMMIO_TEST_BLOCK_CACHE_LOAD__;
    delete window.__STEMMIO_TEST_BLOCK_CANVAS_LOAD__;
    const descriptor = window.__STEMMIO_TEST_CANVAS_DOCUMENT_DESCRIPTOR__;
    if (descriptor) Object.defineProperty(HTMLIFrameElement.prototype, "contentDocument", descriptor);
    delete window.__STEMMIO_TEST_CANVAS_DOCUMENT_DESCRIPTOR__;
    delete window.__STEMMIO_TEST_DELAYED_CACHE_FRAME__;
    delete window.__STEMMIO_TEST_DELAYED_CACHE_ON_LOAD__;
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
    await expect(firstLaunch.page.getByTestId("workbench-document-surface-cache")
      .locator("[data-tab-id] iframe")).toHaveCount(0);

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
    injectedEnv: cachedTabHandoffEnv,
  });
  let firstClosed = false;
  let restored = null;
  let restoredClosed = false;
  let external = null;
  try {
    await loadedDiskFrame(first.page, projectA.sourcePath, "list-item");
    await expect(first.page.locator('[data-testid="workbench-document-surface-cache"] iframe'))
      .toHaveCount(0);
    await openRecentProject(first.page, projectB.sourcePath);
    const firstTabs = first.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    await expect(firstTabs).toHaveCount(2);
    await expect(firstTabs.filter({ hasText: "registry-restart-b" })).toHaveAttribute("aria-selected", "true");
    const surfaceCache = first.page.getByTestId("workbench-document-surface-cache");
    // The inactive tab retains exact HTML data and reading state, not a live
    // display document. A cached return may mount only during the handoff.
    await expect(surfaceCache).toHaveAttribute("data-cache-entry-count", "2");
    await expect(surfaceCache).toHaveAttribute("data-mounted-count", "0");
    await expect(surfaceCache.locator("iframe")).toHaveCount(0);
    await first.page.evaluate(() => {
      const root = document.querySelector('[data-testid="workbench-document-surface-cache"]');
      window.__STEMMIO_TEST_HANDOFF_MAX__ = 0;
      const sample = () => {
        window.__STEMMIO_TEST_HANDOFF_MAX__ = Math.max(
          window.__STEMMIO_TEST_HANDOFF_MAX__ || 0,
          root?.querySelectorAll("iframe").length || 0,
        );
      };
      sample();
      const observer = new MutationObserver(sample);
      if (root) observer.observe(root, { childList: true, subtree: true });
      window.__STEMMIO_TEST_HANDOFF_OBSERVER__ = observer;
    });
    const workbench = first.page.locator("main.workbench");
    const generationBeforeA = Number(await workbench.getAttribute(
      "data-canvas-generation",
    ));
    await firstTabs.filter({ hasText: "registry-restart-a" }).click();
    await loadedDiskFrame(first.page, projectA.sourcePath, "list-item");
    expect(Number(await workbench.getAttribute("data-canvas-generation")))
      .toBe(generationBeforeA + 1);
    await expect.poll(() => first.page.evaluate(() => (
      window.__STEMMIO_TEST_HANDOFF_MAX__ || 0
    ))).toBeGreaterThanOrEqual(1);
    await expect.poll(() => first.page.evaluate(() => (
      window.__STEMMIO_TEST_HANDOFF_MAX__ || 0
    ))).toBeLessThanOrEqual(2);
    await expect(surfaceCache).toHaveAttribute("data-mounted-count", "0");
    await expect(surfaceCache.locator("iframe")).toHaveCount(0);
    const generationBeforeB = Number(await workbench.getAttribute(
      "data-canvas-generation",
    ));
    await firstTabs.filter({ hasText: "registry-restart-b" }).click();
    await loadedDiskFrame(first.page, projectB.sourcePath, "list-item");
    expect(Number(await workbench.getAttribute("data-canvas-generation")))
      .toBe(generationBeforeB + 1);
    await first.page.evaluate(() => {
      window.__STEMMIO_TEST_HANDOFF_OBSERVER__?.disconnect();
      delete window.__STEMMIO_TEST_HANDOFF_OBSERVER__;
    });
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
    // Restart restoration begins the authoritative open immediately. It does
    // not read a presentation projection or wait for a cache surface first.
    await expect(restored.page.locator('[data-testid="workbench-document-surface-cache"] iframe'))
      .toHaveCount(0, { timeout: 30_000 });
    const readStartupPresentation = () => restored.page.evaluate(() => ({
      visible: performance.getEntriesByName("stemmio:tab-cache:visible-ready", "mark")[0]
        ?.startTime || null,
      verified: (() => {
        return performance.getEntriesByName("stemmio:canvas:render-verified", "mark")
          .at(-1)?.startTime || null;
      })(),
    }));
    await expect.poll(readStartupPresentation).toMatchObject({
      visible: null,
      verified: expect.any(Number),
    });

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

test("Electron fences rapid cached A-to-B-to-C returns by navigation handoff identity", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(300_000);
  const projectA = createSourceFixture("cache-handoff-a.html");
  const projectB = createSourceFixture("cache-handoff-b.html");
  const projectC = createSourceFixture("cache-handoff-c.html");
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath, projectC.sourcePath],
    injectedEnv: cachedTabHandoffEnv,
  });
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await openRecentProject(launched.page, projectB.sourcePath);
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    await openRecentProject(launched.page, projectC.sourcePath);
    await loadedDiskFrame(launched.page, projectC.sourcePath, "list-item");

    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    const tabA = tabs.filter({ hasText: "cache-handoff-a" });
    const tabB = tabs.filter({ hasText: "cache-handoff-b" });
    const tabC = tabs.filter({ hasText: "cache-handoff-c" });
    const tabCId = String(await tabC.getAttribute("id") || "").replace(/^workbench-tab-/u, "");
    const surfaceCache = launched.page.getByTestId("workbench-document-surface-cache");
    await expect(tabs).toHaveCount(3);
    await expect(surfaceCache).toHaveAttribute("data-cache-entry-count", "3");
    await launched.page.evaluate(() => {
      const root = document.querySelector('[data-testid="workbench-document-surface-cache"]');
      const candidates = [];
      let lastCandidate = "";
      window.__STEMMIO_TEST_HANDOFF_MAX__ = 0;
      const sample = () => {
        window.__STEMMIO_TEST_HANDOFF_MAX__ = Math.max(
          window.__STEMMIO_TEST_HANDOFF_MAX__ || 0,
          root?.querySelectorAll("iframe").length || 0,
        );
        const tabId = root?.getAttribute("data-candidate-tab-id") || "";
        const handoffId = root?.getAttribute("data-candidate-handoff-id") || "";
        const candidate = `${tabId}:${handoffId}`;
        if (tabId && handoffId && candidate !== lastCandidate) {
          candidates.push({ tabId, handoffId });
          lastCandidate = candidate;
        }
      };
      const observer = new MutationObserver(sample);
      if (root) observer.observe(root, {
        attributes: true,
        attributeFilter: ["data-candidate-tab-id", "data-candidate-handoff-id"],
        childList: true,
        subtree: true,
      });
      sample();
      window.__STEMMIO_TEST_HANDOFF_CANDIDATES__ = candidates;
      window.__STEMMIO_TEST_HANDOFF_OBSERVER__ = observer;
    });

    // Queue three returns without waiting for a prior Canvas to settle. The
    // final C visit has the same bytes as the already-cached C tab, but must
    // get a fresh handoff identity rather than accept an A/B callback.
    await tabA.dispatchEvent("click");
    await tabB.dispatchEvent("click");
    await tabC.dispatchEvent("click");
    await loadedDiskFrame(launched.page, projectC.sourcePath, "list-item");
    await expect(tabC).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => launched.page.evaluate(() => (
      window.__STEMMIO_TEST_HANDOFF_MAX__ || 0
    ))).toBeLessThanOrEqual(2);

    // A second C return proves that a same-Hash navigation round does not
    // reuse the prior C surface's handoff token.
    await tabB.click();
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    await tabC.click();
    await loadedDiskFrame(launched.page, projectC.sourcePath, "list-item");
    await expect(tabC).toHaveAttribute("aria-selected", "true");
    const observedCandidates = await launched.page.evaluate(() => (
      window.__STEMMIO_TEST_HANDOFF_CANDIDATES__ || []
    ));
    const cHandoffs = observedCandidates
      .filter((candidate) => candidate.tabId === tabCId)
      .map((candidate) => candidate.handoffId);
    expect(new Set(cHandoffs).size).toBeGreaterThanOrEqual(2);
    await expect(surfaceCache).toHaveAttribute("data-mounted-count", "0");
    await expect(surfaceCache.locator("iframe")).toHaveCount(0);
  } finally {
    await launched.page.evaluate(() => {
      window.__STEMMIO_TEST_HANDOFF_OBSERVER__?.disconnect();
      delete window.__STEMMIO_TEST_HANDOFF_OBSERVER__;
      delete window.__STEMMIO_TEST_HANDOFF_CANDIDATES__;
    }).catch(() => {});
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
    removeSourceFixture(projectC.sourceDirectory);
  }
});

test("Electron releases a delayed cache iframe when the verified Canvas arrives first", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("cache-late-a.html");
  const projectB = createSourceFixture("cache-late-b.html");
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
    injectedEnv: cachedTabHandoffEnv,
  });
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await openRecentProject(launched.page, projectB.sourcePath);
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    const tabA = tabs.filter({ hasText: "cache-late-a" });
    const tabB = tabs.filter({ hasText: "cache-late-b" });
    const surfaceCache = launched.page.getByTestId("workbench-document-surface-cache");
    const visibleReadyBefore = await launched.page.evaluate(() => (
      performance.getEntriesByName("stemmio:tab-cache:visible-ready", "mark").length
    ));
    await launched.page.evaluate(() => {
      const root = document.querySelector('[data-testid="workbench-document-surface-cache"]');
      window.__STEMMIO_TEST_HANDOFF_MAX__ = 0;
      const sample = () => {
        window.__STEMMIO_TEST_HANDOFF_MAX__ = Math.max(
          window.__STEMMIO_TEST_HANDOFF_MAX__ || 0,
          root?.querySelectorAll("iframe").length || 0,
        );
      };
      const observer = new MutationObserver(sample);
      if (root) observer.observe(root, { childList: true, subtree: true });
      const blockCacheLoad = (event) => {
        const target = event.target;
        if (
          target instanceof HTMLIFrameElement
          && target.closest('[data-testid="workbench-document-surface-cache"]')
        ) {
          event.stopImmediatePropagation();
          event.stopPropagation();
        }
      };
      document.addEventListener("load", blockCacheLoad, true);
      sample();
      window.__STEMMIO_TEST_HANDOFF_OBSERVER__ = observer;
      window.__STEMMIO_TEST_BLOCK_CACHE_LOAD__ = blockCacheLoad;
    });

    await tabA.click();
    await expect.poll(() => launched.page.evaluate(() => (
      window.__STEMMIO_TEST_HANDOFF_MAX__ || 0
    ))).toBeGreaterThanOrEqual(1);
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await expect(surfaceCache).toHaveAttribute("data-mounted-count", "0");
    await expect(surfaceCache.locator("iframe")).toHaveCount(0);
    await expect.poll(() => launched.page.evaluate(() => (
      performance.getEntriesByName("stemmio:tab-cache:visible-ready", "mark").length
    ))).toBe(visibleReadyBefore);

    await launched.page.evaluate(() => {
      const blockCacheLoad = window.__STEMMIO_TEST_BLOCK_CACHE_LOAD__;
      if (blockCacheLoad) document.removeEventListener("load", blockCacheLoad, true);
      window.__STEMMIO_TEST_HANDOFF_OBSERVER__?.disconnect();
      delete window.__STEMMIO_TEST_HANDOFF_OBSERVER__;
      delete window.__STEMMIO_TEST_BLOCK_CACHE_LOAD__;
    });
    await tabB.click();
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
  } finally {
    await launched.page.evaluate(() => {
      const blockCacheLoad = window.__STEMMIO_TEST_BLOCK_CACHE_LOAD__;
      if (blockCacheLoad) document.removeEventListener("load", blockCacheLoad, true);
      window.__STEMMIO_TEST_HANDOFF_OBSERVER__?.disconnect();
      delete window.__STEMMIO_TEST_HANDOFF_OBSERVER__;
      delete window.__STEMMIO_TEST_BLOCK_CACHE_LOAD__;
    }).catch(() => {});
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("Electron retains an accepted B cache iframe while C waits, then ignores C's saved ready callback", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(240_000);
  const projectA = createSourceFixture("cache-retained-b-a.html");
  const projectB = createSourceFixture("cache-retained-b-b.html", (source) => source.replace(
    /<\/body>/iu,
    "<!-- retained-cache-b --></body>",
  ));
  const projectC = createSourceFixture("cache-retained-b-c.html", (source) => source.replace(
    /<\/body>/iu,
    "<!-- retained-cache-c --></body>",
  ));
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath, projectC.sourcePath],
    injectedEnv: cachedTabHandoffEnv,
  });
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await openRecentProject(launched.page, projectB.sourcePath);
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    await openRecentProject(launched.page, projectC.sourcePath);
    await loadedDiskFrame(launched.page, projectC.sourcePath, "list-item");
    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    const tabB = tabs.filter({ hasText: "cache-retained-b-b" });
    const tabC = tabs.filter({ hasText: "cache-retained-b-c" });
    const tabBId = String(await tabB.getAttribute("id") || "").replace(/^workbench-tab-/u, "");
    const tabCId = String(await tabC.getAttribute("id") || "").replace(/^workbench-tab-/u, "");
    const surfaceCache = launched.page.getByTestId("workbench-document-surface-cache");
    const canvasSurface = launched.page.getByTestId("workbench-active-document-canvas");

    // Document capture holds B's real Canvas load handler while its
    // script-disabled static iframe still reports ready. This gives us a real
    // accepted cover to retain while the next candidate loads.
    await holdCacheAndCanvasLoads(launched.page);
    await tabB.click();
    await expect(tabB).toHaveAttribute("aria-selected", "true");
    await expect(surfaceCache).toHaveAttribute("data-visible-tab-id", tabBId);
    await expect(surfaceCache).toHaveAttribute("data-candidate-tab-id", tabBId);
    await expect(surfaceCache).toHaveAttribute("data-mounted-count", "1");
    await launched.page.evaluate(() => {
      const root = document.querySelector('[data-testid="workbench-document-surface-cache"]');
      const frame = root?.querySelector('[data-surface-role="presented"] iframe');
      if (!(frame instanceof HTMLIFrameElement)) {
        throw new Error(`B cache cover was not mounted: ${root?.outerHTML || "missing root"}`);
      }
      window.__STEMMIO_TEST_PRESENTED_CACHE_FRAME__ = frame;
    });

    // C's static and Canvas callbacks are both held. B must remain the actual
    // visible iframe, while C cannot inherit B's ready state.
    await launched.page.evaluate(() => {
      window.__STEMMIO_TEST_BLOCK_CACHE_LOAD__ = true;
    });
    await tabC.click();
    await expect(tabC).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => launched.page.evaluate(() => {
      const root = document.querySelector('[data-testid="workbench-document-surface-cache"]');
      const presented = root?.querySelector('[data-surface-role="presented"] iframe');
      const candidate = root?.querySelector('[data-surface-role="candidate"] iframe');
      return {
        visibleTabId: root?.getAttribute("data-visible-tab-id") || null,
        candidateTabId: root?.getAttribute("data-candidate-tab-id") || null,
        mounted: root?.getAttribute("data-mounted-count") || null,
        samePresentedFrame: presented === window.__STEMMIO_TEST_PRESENTED_CACHE_FRAME__,
        presentedConnected: Boolean(presented?.isConnected),
        presentedHidden: presented?.closest("[data-surface-role]")?.hidden || false,
        candidateHidden: candidate?.closest("[data-surface-role]")?.hidden || false,
        candidateExists: candidate instanceof HTMLIFrameElement,
        distinctFrames: candidate !== window.__STEMMIO_TEST_PRESENTED_CACHE_FRAME__,
        canvasInert: document.querySelector('[data-testid="workbench-active-document-canvas"]')
          ?.hasAttribute("inert") || false,
      };
    })).toEqual({
      visibleTabId: tabBId,
      candidateTabId: tabCId,
      mounted: "2",
      samePresentedFrame: true,
      presentedConnected: true,
      presentedHidden: false,
      candidateHidden: true,
      candidateExists: true,
      distinctFrames: true,
      canvasInert: true,
    });
    await expect.poll(() => launched.page.evaluate(() => ({
      delayedCache: Boolean(window.__STEMMIO_TEST_DELAYED_CACHE_FRAME__),
      savedReady: typeof window.__STEMMIO_TEST_DELAYED_CACHE_ON_LOAD__ === "function",
      delayedCanvas: Boolean(window.__STEMMIO_TEST_DELAYED_CANVAS_FRAME__),
      savedCanvasReady: typeof window.__STEMMIO_TEST_DELAYED_CANVAS_ON_LOAD__ === "function",
    }))).toEqual({
      delayedCache: true,
      savedReady: true,
      delayedCanvas: true,
      savedCanvasReady: true,
    });

    await expect(launched.page.locator("[data-edit-runtime-phase]"))
      .toHaveAttribute("data-edit-runtime-phase", "ready");

    // Complete C through the saved real Canvas handler while its prior static
    // load callback remains saved. Terminal Canvas authority must retire both
    // static frames before that stale callback can be invoked.
    await launched.page.evaluate(() => {
      const onLoad = window.__STEMMIO_TEST_DELAYED_CANVAS_ON_LOAD__;
      const frame = window.__STEMMIO_TEST_DELAYED_CANVAS_FRAME__;
      if (typeof onLoad !== "function" || !(frame instanceof HTMLIFrameElement)) {
        throw new Error("C delayed Canvas ready callback was unavailable");
      }
      window.__STEMMIO_TEST_BLOCK_CANVAS_LOAD__ = false;
      onLoad({ currentTarget: frame });
    });
    await loadedDiskFrame(launched.page, projectC.sourcePath, "list-item");
    await expect(surfaceCache).toHaveAttribute("data-mounted-count", "0");
    await expect(surfaceCache.locator("iframe")).toHaveCount(0);
    await expect(canvasSurface).not.toHaveAttribute("inert", "");

    // Invoke the saved real React handler after C's Canvas has taken over.
    // The full handoff token has been retired, so it cannot restore a cover or
    // make the Canvas inert again.
    await launched.page.evaluate(async () => {
      const onLoad = window.__STEMMIO_TEST_DELAYED_CACHE_ON_LOAD__;
      const frame = window.__STEMMIO_TEST_DELAYED_CACHE_FRAME__;
      if (typeof onLoad !== "function" || !(frame instanceof HTMLIFrameElement)) {
        throw new Error("C delayed static ready callback was unavailable");
      }
      onLoad({ currentTarget: frame });
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    });
    await expect(surfaceCache).toHaveAttribute("data-mounted-count", "0");
    await expect(surfaceCache.locator("iframe")).toHaveCount(0);
    await expect(canvasSurface).not.toHaveAttribute("inert", "");
  } finally {
    await releaseCacheAndCanvasLoadHold(launched.page);
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
    removeSourceFixture(projectC.sourceDirectory);
  }
});

test("Electron mounts a hidden new iframe for a same-Hash repeat handoff", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  test.setTimeout(240_000);
  const projectA = createSourceFixture("cache-repeat-hash-a.html");
  const projectB = createSourceFixture("cache-repeat-hash-b.html");
  const projectC = createSourceFixture("cache-repeat-hash-c.html");
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath, projectC.sourcePath],
    injectedEnv: cachedTabHandoffEnv,
  });
  let releaseARead = () => {};
  try {
    await loadedDiskFrame(launched.page, projectA.sourcePath, "list-item");
    await openRecentProject(launched.page, projectB.sourcePath);
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    await openRecentProject(launched.page, projectC.sourcePath);
    await loadedDiskFrame(launched.page, projectC.sourcePath, "list-item");
    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    const tabA = tabs.filter({ hasText: "cache-repeat-hash-a" });
    const tabB = tabs.filter({ hasText: "cache-repeat-hash-b" });
    const tabAId = String(await tabA.getAttribute("id") || "").replace(/^workbench-tab-/u, "");
    const tabBId = String(await tabB.getAttribute("id") || "").replace(/^workbench-tab-/u, "");
    const surfaceCache = launched.page.getByTestId("workbench-document-surface-cache");

    await launched.page.evaluate(() => {
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
      const initial = controller.navigation.getSnapshot();
      const tabIds = initial.tabs.tabs.map((tab) => tab.tabId);
      const missingIds = new Set();
      const off = controller.navigation.subscribe(() => {
        const currentIds = new Set(controller.navigation.getSnapshot().tabs.tabs.map((tab) => tab.tabId));
        for (const tabId of tabIds) if (!currentIds.has(tabId)) missingIds.add(tabId);
      });
      window.__STEMMIO_TEST_CACHE_NAVIGATION__ = {
        refresh: () => controller.projectCatalog.commands.refreshRegistered(),
        read: () => {
          const current = controller.navigation.getSnapshot();
          return {
            missingIds: [...missingIds],
            tabIds: current.tabs.tabs.map((tab) => tab.tabId),
            initialTabIds: tabIds,
            admissions: current.workflow.admissionOrdinal - initial.workflow.admissionOrdinal,
          };
        },
        stop: off,
      };
    });
    await holdCacheAndCanvasLoads(launched.page);
    await tabB.click();
    await expect(tabB).toHaveAttribute("aria-selected", "true");
    await expect(surfaceCache).toHaveAttribute("data-visible-tab-id", tabBId);
    const oldHandoffId = String(await surfaceCache.getAttribute("data-visible-handoff-id") || "");
    expect(oldHandoffId).not.toBe("");
    await launched.page.evaluate(() => {
      const frame = document.querySelector(
        '[data-testid="workbench-document-surface-cache"] [data-surface-role="presented"] iframe',
      );
      if (!(frame instanceof HTMLIFrameElement)) throw new Error("B cache cover was not mounted");
      window.__STEMMIO_TEST_PRESENTED_CACHE_FRAME__ = frame;
      window.__STEMMIO_TEST_BLOCK_CACHE_LOAD__ = true;
    });

    // Re-enter B through a different navigation round while its accepted old
    // cover remains on screen. Observe A as the first candidate before
    // selecting B: this preserves the real navigation order without giving
    // the held Canvas enough time to reach its timeout path.
    let aReadEntered = false;
    // Hold the real A read while B is queued. A catalog refresh at this
    // boundary is a projection update, not permission to replay startup.
    await launched.page.route("**/workspace?*", async (route) => {
      const source = new URL(route.request().url()).searchParams.get("sourcePath");
      if (!aReadEntered && source && path.basename(source) === path.basename(projectA.sourcePath)) {
        aReadEntered = true;
        await new Promise((resolve) => { releaseARead = resolve; });
      }
      await route.continue();
    });
    await tabA.dispatchEvent("click");
    await expect(surfaceCache).toHaveAttribute("data-candidate-tab-id", tabAId);
    await tabB.dispatchEvent("click");
    await expect.poll(() => aReadEntered).toBe(true);
    await launched.page.evaluate(() => window.__STEMMIO_TEST_CACHE_NAVIGATION__.refresh());
    releaseARead();
    await expect(surfaceCache).toHaveAttribute("data-candidate-tab-id", tabBId);
    await expect(surfaceCache).toHaveAttribute("data-mounted-count", "2");
    const repeatHandoffState = await launched.page.evaluate(() => {
      const root = document.querySelector('[data-testid="workbench-document-surface-cache"]');
      const presented = root?.querySelector('[data-surface-role="presented"] iframe');
      const candidate = root?.querySelector('[data-surface-role="candidate"] iframe');
      return {
        visibleTabId: root?.getAttribute("data-visible-tab-id") || null,
        visibleHandoffId: root?.getAttribute("data-visible-handoff-id") || null,
        candidateTabId: root?.getAttribute("data-candidate-tab-id") || null,
        candidateHandoffId: root?.getAttribute("data-candidate-handoff-id") || null,
        mounted: root?.getAttribute("data-mounted-count") || null,
        samePresentedFrame: presented === window.__STEMMIO_TEST_PRESENTED_CACHE_FRAME__,
        presentedHidden: presented?.closest("[data-surface-role]")?.hidden || false,
        candidateHidden: candidate?.closest("[data-surface-role]")?.hidden || false,
        candidateExists: candidate instanceof HTMLIFrameElement,
        distinctFrames: candidate !== window.__STEMMIO_TEST_PRESENTED_CACHE_FRAME__,
        canvasInert: document.querySelector('[data-testid="workbench-active-document-canvas"]')
          ?.hasAttribute("inert") || false,
      };
    });
    expect(repeatHandoffState).toMatchObject({
      visibleTabId: tabBId,
      visibleHandoffId: oldHandoffId,
      candidateTabId: tabBId,
      mounted: "2",
      samePresentedFrame: true,
      presentedHidden: false,
      candidateHidden: true,
      distinctFrames: true,
      canvasInert: true,
    });
    const newHandoffId = String(await surfaceCache.getAttribute("data-candidate-handoff-id") || "");
    expect(newHandoffId).not.toBe("");
    expect(newHandoffId).not.toBe(oldHandoffId);
    await expect(tabB).toHaveAttribute("aria-selected", "true");
    await expect.poll(() => launched.page.evaluate(() => {
      const frame = window.__STEMMIO_TEST_DELAYED_CANVAS_FRAME__;
      return typeof window.__STEMMIO_TEST_DELAYED_CANVAS_ON_LOAD__ === "function"
        && frame?.isConnected
        && frame === document.querySelector(
          '[data-testid="html-canvas-editor"] iframe[data-runtime-slot-role="active"]',
        );
    })).toBe(true);
    await launched.page.evaluate(() => {
      const onLoad = window.__STEMMIO_TEST_DELAYED_CANVAS_ON_LOAD__;
      const frame = window.__STEMMIO_TEST_DELAYED_CANVAS_FRAME__;
      window.__STEMMIO_TEST_BLOCK_CANVAS_LOAD__ = false;
      onLoad({ currentTarget: frame });
    });
    await loadedDiskFrame(launched.page, projectB.sourcePath, "list-item");
    await expect(tabB).toHaveAttribute("aria-selected", "true");
    await expect(surfaceCache).toHaveAttribute("data-mounted-count", "0");

    const navigation = await launched.page.evaluate(() => window.__STEMMIO_TEST_CACHE_NAVIGATION__.read());
    expect(navigation.missingIds).toEqual([]);
    expect(navigation.tabIds).toEqual(navigation.initialTabIds);
    expect(navigation.admissions).toBe(3);
  } finally {
    releaseARead();
    await launched.page.evaluate(() => {
      window.__STEMMIO_TEST_CACHE_NAVIGATION__?.stop();
      delete window.__STEMMIO_TEST_CACHE_NAVIGATION__;
    }).catch(() => {});
    await releaseCacheAndCanvasLoadHold(launched.page);
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
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
    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
    const tabA = tabs.filter({ hasText: "tab-reading-a" });
    const tabB = tabs.filter({ hasText: "tab-reading-b" });
    const surfaceCache = launched.page.getByTestId("workbench-document-surface-cache");
    await expect(surfaceCache).toHaveAttribute("data-cache-entry-count", "1");
    await expect(surfaceCache).toHaveAttribute("data-cold-count", "1");

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
    await expect(surfaceCache).toHaveAttribute("data-cache-entry-count", "1");
    await expect(surfaceCache).toHaveAttribute("data-cold-count", "1");
    await expect(surfaceCache.locator("iframe")).toHaveCount(0);
    await launched.page.evaluate(() => {
      const root = document.querySelector('[data-testid="workbench-document-surface-cache"]');
      window.__STEMMIO_TEST_HANDOFF_MAX__ = 0;
      const sample = () => {
        window.__STEMMIO_TEST_HANDOFF_MAX__ = Math.max(
          window.__STEMMIO_TEST_HANDOFF_MAX__ || 0,
          root?.querySelectorAll("iframe").length || 0,
        );
      };
      const observer = new MutationObserver(sample);
      if (root) observer.observe(root, { childList: true, subtree: true });
      window.__STEMMIO_TEST_HANDOFF_OBSERVER__ = observer;
    });

    await tabA.click();
    await waitForProjectReady(launched.page);
    await expect(tabA).toHaveAttribute("aria-selected", "true");
    await expect(mode.getByRole("button", { name: "预览", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect(previewFrame.locator("body")).toBeVisible();
    await expect.poll(() => previewFrame.locator("body").evaluate(() => window.scrollY))
      .toBeGreaterThan(previewScrollTop - 40);
    await expect.poll(() => launched.page.evaluate(() => (
      window.__STEMMIO_TEST_HANDOFF_MAX__ || 0
    ))).toBe(0);
    await expect(surfaceCache).toHaveAttribute("data-mounted-count", "0");
    await expect(surfaceCache.locator("iframe")).toHaveCount(0);
    await launched.page.evaluate(() => {
      window.__STEMMIO_TEST_HANDOFF_OBSERVER__?.disconnect();
      delete window.__STEMMIO_TEST_HANDOFF_OBSERVER__;
    });
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
    await recoveryDialog.getByRole("button", { name: "关闭", exact: true }).click();
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

test("Electron retires the cache after same-source hydration advances Canvas authority", {
  tag: ["@gate-smoke", "@smoke-project-lifecycle"],
}, async () => {
  const projectA = createSourceFixture("cache-authority-a.html");
  const projectB = createSourceFixture("cache-authority-b.html");
  const original = readFileSync(projectA.sourcePath, "utf8");
  const launched = await launchStemmio({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
    injectedEnv: cachedTabHandoffEnv,
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
    await holdCacheAndCanvasLoads(launched.page);
    const openPromise = openRecentProject(
      launched.page, workingPath, "list-item", path.basename(projectA.sourcePath),
    );
    // Preserve the navigation error while the controlled Canvas load is held.
    openPromise.catch(() => {});
    const surfaceCache = launched.page.getByTestId("workbench-document-surface-cache");
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
    await expect(surfaceCache).toHaveAttribute("data-visible", "true");
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
    await expect(surfaceCache).toHaveAttribute("data-mounted-count", "0");
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
    await releaseCacheAndCanvasLoadHold(launched.page);
    await stopStemmio(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

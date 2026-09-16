import { seedLegacyHistoryActivation } from "../../helpers/legacy-history-activation.mjs";
import { expect, test } from "@playwright/test";
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
    }).toMatchObject({ version: 1, activeTabId: null });

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
    await firstTabs.filter({ hasText: "registry-restart-a" }).click();
    await loadedDiskFrame(first.page, projectA.sourcePath, "list-item");
    await expect.poll(() => first.page.evaluate(() => (
      window.__STEMMIO_TEST_HANDOFF_MAX__ || 0
    ))).toBeGreaterThanOrEqual(1);
    await expect(surfaceCache).toHaveAttribute("data-mounted-count", "0");
    await expect(surfaceCache.locator("iframe")).toHaveCount(0);
    await firstTabs.filter({ hasText: "registry-restart-b" }).click();
    await loadedDiskFrame(first.page, projectB.sourcePath, "list-item");
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
    await expect(tabs.filter({ hasText: "sidebar-history-b" }))
      .toHaveAttribute("aria-selected", "true", { timeout: 60_000 });
    await expect.poll(() => sidebar.locator(".sidebar-version-tree").count())
      .toBeGreaterThan(0);
    await expect.poll(() => launched.page.locator(".preview-navigation-banner").count(), {
      timeout: 60_000,
    }).toBe(1);
    await expect(launched.page.locator(".preview-navigation-banner").first())
      .toContainText("正在浏览");

    const mode = launched.page.getByRole("group", { name: "工作模式", exact: true });
    const selectedB = tabs.filter({ hasText: "sidebar-history-b" });
    await expect(selectedB).toContainText(`${historicalVersion.displayFileName} · 历史`);
    await expect(importedProject.locator('[data-selected="true"] .sidebar-version-file')).toHaveAccessibleName(`V${historicalVersion.ordinal}，历史版本`);
    await expect(importedProject.locator('[data-selected="true"] .sidebar-version-time'))
      .toHaveAttribute("datetime", historicalVersion.modifiedAt);
    await expect(mode).toHaveAttribute("data-view-label", "历史");
    await expect(mode.getByRole("button", { name: "编辑", exact: true })).toBeEnabled();
    const historicalPreview = launched.page.frameLocator('iframe[title="HTML 交互预览"]');
    await expect(historicalPreview.locator("body")).toBeVisible();
    await expect.poll(async () => (await launched.page.locator('iframe[title="HTML 交互预览"]').boundingBox())?.height || 0).toBeGreaterThan(400);
    await expect(mode.getByRole("button", { name: "预览", exact: true })).toHaveAttribute("aria-pressed", "true");
    const protectedWorkingBytes = readFileSync(target.exactSourcePath, "utf8");
    await expect.poll(() => historicalPreview.locator("title").textContent()).toBe("sidebar history V3");
    await launched.page.screenshot({ path: test.info().outputPath("version-history-projection.png") });
    await launched.page.getByRole("button", { name: "回到当前稿", exact: true }).click();
    await expect(selectedB).toContainText(path.basename(target.exactSourcePath));
    await expect(selectedB).not.toContainText("历史");
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
    await expect(tabs).toHaveCount(2);
    await expect(tabs.filter({ hasText: "sidebar-history-a" })).toHaveAttribute("aria-selected", "true");
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
    await expect(selectedB).toHaveAttribute("aria-selected", "true");
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
    await expect(selectedB).toContainText(`${historicalVersion.displayFileName} · 历史`);
    await expect(mode).toHaveAttribute("data-view-label", "历史");
    const edit = mode.getByRole("button", { name: "编辑", exact: true });
    await edit.click();
    const dialog = launched.page.getByRole("dialog", { name: /基于.*创建新版本/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "取消", exact: true }).click();
    expect((await repository.listRegisteredProjectVersionSummaries({ projectId: target.projectId })).versions).toHaveLength(8);
    await expect(mode.getByRole("button", { name: "预览", exact: true })).toHaveAttribute("aria-pressed", "true");

    const exportPath = path.join(projectB.sourceDirectory, "exported-history-v3.html");
    await launched.electronApp.evaluate(({ dialog }, filePath) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath });
    }, exportPath);
    await launched.page.getByRole("button", { name: "更多", exact: true }).click();
    await expect(launched.page.getByRole("menuitem", { name: "在 Finder 中显示当前工作文件", exact: true })).toBeVisible();
    await expect(launched.page.getByRole("menuitem", { name: "在浏览器中打开当前工作文件", exact: true })).toBeVisible();
    await launched.page.getByRole("menuitem", { name: "导出此版本…", exact: true }).click();
    const historicalBytes = await repository.readVersionFile({ target, versionId: "ver_0003" });
    await expect.poll(() => { try { return readFileSync(exportPath, "utf8"); } catch { return null; } }).toBe(historicalBytes.content);
    expect(readFileSync(target.exactSourcePath, "utf8")).toBe(protectedWorkingBytes);

    let creates = 0;
    const loseReceipt = async (route) => { creates += 1; await route.fetch(); await route.abort("failed"); };
    const failCreatedOpen = async (route) => {
      if (creates > 0 && new URL(route.request().url()).searchParams.get("sourcePath") === target.exactSourcePath) {
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: { code: "TEST_OPEN_FAILED", message: "测试新稿打开失败" } }) });
      } else await route.continue();
    };
    await launched.page.route("**/history-version/create", loseReceipt);
    await launched.page.route("**/workspace?*", failCreatedOpen);
    await edit.click();
    await dialog.getByRole("button", { name: "创建并编辑", exact: true }).click();
    await expect(launched.page.getByRole("button", { name: "打开已创建版本", exact: true })).toBeEnabled({ timeout: 30_000 });
    const createdSummary = await repository.listRegisteredProjectVersionSummaries({ projectId: target.projectId });
    expect(createdSummary.versions).toHaveLength(9);
    expect(creates).toBe(1);
    expect((await repository.readVersionFile({ target, versionId: "ver_0008" })).content).toBe(protectedLatest.content);
    expect(readFileSync(target.exactSourcePath, "utf8")).toBe(historicalBytes.content);
    await expect(mode).toHaveAttribute("data-view-label", "历史");
    await launched.page.unroute("**/workspace?*", failCreatedOpen);
    await currentProject.locator(".sidebar-project-current-row").click();
    await expect(tabs.filter({ hasText: "sidebar-history-a" })).toHaveAttribute("aria-selected", "true");
    await expect(launched.page.getByRole("button", { name: "打开已创建版本", exact: true })).toHaveCount(0);
    await waitForProjectReady(launched.page);
    await importedProject.getByRole("button", { name: `V${historicalVersion.ordinal}，历史版本`, exact: true }).click();
    await expect(mode).toHaveAttribute("data-view-label", "历史");
    await expect(launched.page.getByRole("button", { name: "打开已创建版本", exact: true })).toBeEnabled();
    await launched.page.getByRole("button", { name: "打开已创建版本", exact: true }).click();
    await expect(selectedB).toContainText(path.basename(target.exactSourcePath), { timeout: 60_000 });
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
    await expect(reopened.page.getByRole("tab", { selected: true })).toContainText(path.basename(createdPath));
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

test("Electron sidebar keeps multiple project lists expanded without switching identity", {
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

    const versionVisualFacts = await projectCContainer.locator(".sidebar-version-tree")
      .evaluate((tree) => ({
        fileIcons: tree.querySelectorAll(".sidebar-version-file > svg").length,
        currentLabels: tree.querySelectorAll(".sidebar-version-current-label").length,
        ordinals: [...tree.querySelectorAll(".sidebar-version-index")].map((element) => element.textContent),
      }));
    expect(versionVisualFacts.fileIcons).toBe(0);
    expect(versionVisualFacts.currentLabels).toBe(0);
    expect(versionVisualFacts.ordinals).toEqual(["V1", "V2", "V3"]);

    const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
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
      await mode.getByRole("button", { name: "编辑", exact: true }).click();
      await app.page.getByRole("dialog").getByRole("button", { name: "创建并编辑", exact: true }).click();
      if (recoveryCase === "pending") await expect(app.page.getByRole("button", { name: "打开已创建版本", exact: true })).toBeEnabled();
      else {
        await expect(mode).toHaveAttribute("data-view-label", "当前");
        await expect(app.page.getByRole("tab", { selected: true })).toContainText(path.basename(initialPath));
        // The selected tab is published before the navigation owner releases
        // its close guard. Wait for the public toolbar boundary before restart.
        await expect(mode.getByRole("button", { name: "编辑", exact: true })).toBeEnabled();
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
        await closeStemmioGracefully(app.electronApp, app.page);
      }
      app = null;
      if (recoveryCase === "rename") {
        const renamed = path.join(target.projectRootPath, "renamed-history.html");
        renameSync(expectedPath, renamed);
        await repository.workspace({ sourcePath: renamed });
        expectedPath = renamed;
      }
      // The pending case intentionally uses the existing persisted tab. For
      // a later AI promotion, seed its selected working file as the open target.
      app = await launchStemmio({ isolatedUserData: userData,
        ...(recoveryCase === "superseded" ? { activeSourcePath: expectedPath } : {}) });
      await waitForProjectReady(app.page);
      await expect(app.page.getByRole("tab", { selected: true })).toContainText(path.basename(expectedPath));
      if (recoveryCase === "superseded") {
        // Persist the selected V10, then exercise an ordinary restart without
        // a command-line target. The V9 acknowledgment is still missing.
        await closeStemmioGracefully(app.electronApp, app.page);
        app = null;
        app = await launchStemmio({ isolatedUserData: userData });
        await waitForProjectReady(app.page);
        await expect(app.page.getByRole("tab", { selected: true })).toContainText(path.basename(expectedPath));
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
        await expect.poll(async () => (await repository.queryHistoryCreation({ target, operationId })).openedAt).not.toBeNull();
      }
      await app.page.getByRole("button", { name: "展开左侧边栏", exact: true }).click();
      await app.page.locator(".sidebar-project-history-toggle").click();
      const restoredMode = app.page.getByRole("group", { name: "工作模式", exact: true });
      await expect(restoredMode.getByRole("button", { name: "编辑", exact: true })).toBeEnabled();
      await app.page.getByRole("button", { name: `V${historical.ordinal}，历史版本`, exact: true }).click();
      await expect(restoredMode).toHaveAttribute("data-view-label", "历史");
      await restoredMode.getByRole("button", { name: "编辑", exact: true }).click();
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
    const secondEdit = await editCurrent("LOCAL_EXPORT_TWO");

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

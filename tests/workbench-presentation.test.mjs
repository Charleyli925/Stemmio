import assert from "node:assert/strict";
import test from "node:test";
import { loadWorkbenchModel } from "./helpers/workbench-model-loader.mjs";
const { deriveWorkbenchPresentation } = await loadWorkbenchModel("workbench-header-projection");
const { orderedProjectVersions } = await loadWorkbenchModel("project-version-tree-model");
function input() {
  return {
    project: { projectId: "A", documentId: "docA", sourcePath: "/A-V2.html" },
    version: { versions: [1, 2, 3].map((i) => ({ id: `v${i}`, label: `V${i}`, displayFileName: `A-V${i}.html` })), currentBasedOnVersionId: "v2", latestVersionId: "v3", viewingVersionId: "v1", viewMode: "current" },
    activeTab: { tabId: "tabA", kind: "document", title: "A-V2.html", projectId: "A", documentId: "docA" },
    canvasMode: "edit", reviewActive: false, hasReadyPayload: false, hasReadyReviewSession: false,
    reviewPreparing: false, canShowCurrentFileInFolder: true, canOpenCurrentHtmlInDefaultBrowser: true,
    persistState: "idle", editRevision: 0, lastPersistedRevision: 0, hasWorkspaceController: true,
    projectHydrating: false, projectLoadError: false, viewTransitioning: false, runInProgress: false,
    workspaceIssue: false, externalSourcePreview: false, hasDocumentHistoryAction: false, interactionLocked: false,
  };
}
test("history gives sidebar and tab the viewed Version while retaining distinct current/latest identities", () => {
  const source = input(); source.version.viewMode = "history";
  source.activeTab = { ...source.activeTab, kind: "history", versionId: "v1", versionOrdinal: 1, title: "A" };
  const p = deriveWorkbenchPresentation(source);
  assert.equal(p.selectedVersionId, "v1"); assert.equal(p.displayedVersionId, "v1");
  assert.equal(p.tabTitle, "A"); assert.equal(p.viewLabel, "历史");
  assert.equal(p.currentEditingVersionId, "v2"); assert.equal(p.latestVersionId, "v3");
  assert.equal(p.edit.enabled, false); assert.match(p.edit.reason, /预览模式/u);
  assert.equal(p.preview.enabled, true); assert.equal(p.preview.selected, true);
  assert.equal(p.canShowInFinder, false); assert.equal(p.canOpenCurrentHtml, false);
  assert.equal(p.canExportCurrentHtml, true);
  assert.equal(p.canReloadCurrentSource, false);
  assert.equal(p.mode, "preview");
  assert.deepEqual(p.actions.saveVersion, {
    enabled: false, reason: "该操作只针对当前稿", target: "current",
  });
  assert.deepEqual(p.actions.createFromHistory, { enabled: true, reason: undefined, target: "history" });
  assert.deepEqual(p.actions.showInFolder, {
    enabled: false, reason: "历史版本没有独立工作文件；请打开当前稿", target: "current",
  });
  assert.deepEqual(p.actions.openInBrowser, {
    enabled: false, reason: "浏览器只能打开当前工作文件；历史版本可直接导出", target: "current",
  });
  assert.deepEqual(p.actions.exportHtml, { enabled: true, reason: undefined, target: "history" });
  assert.deepEqual(p.actions.preservedDrafts, {
    enabled: false, reason: "请先打开当前稿，再找回以前保留的稿件", target: "current",
  });
  assert.deepEqual(p.actions.reloadSource, {
    enabled: false, reason: "历史版本不会从磁盘重载；请打开当前稿", target: "current",
  });
  assert.equal(source.version.currentBasedOnVersionId, "v2");
});
test("current and review share a selected baseline and change only their display and permissions", () => {
  const source = input(); const current = deriveWorkbenchPresentation(source);
  assert.equal(current.selectedVersionId, "v2"); assert.equal(current.tabTitle, "A-V2.html");
  assert.equal(current.viewLabel, "当前"); assert.equal(current.edit.enabled, true);
  source.reviewActive = true;
  const review = deriveWorkbenchPresentation(source);
  assert.equal(review.selectedVersionId, "v2"); assert.equal(review.viewLabel, "审阅");
  assert.equal(review.edit.enabled, false); assert.equal(review.preview.enabled, false);
  assert.equal(review.review.selected, true);
});
test("a different project tab cannot inherit the old project's history or selection", () => {
  const source = input(); source.version.viewMode = "history";
  source.activeTab = { ...source.activeTab, kind: "history", projectId: "B", documentId: "docB", tabId: "tabB", title: "B.html", versionId: "v1", versionOrdinal: 1 };
  const p = deriveWorkbenchPresentation(source);
  assert.equal(p.tabTitle, "B.html"); assert.equal(p.selectedVersionId, null);
  assert.equal(p.displayedVersion, null); assert.equal(p.viewLabel, null);
  assert.equal(p.currentEditingVersionId, null); assert.equal(p.latestVersionId, null);
});
test("safety conditions continue to control file and mode buttons", () => {
  const source = input(); source.runInProgress = true; source.interactionLocked = true;
  source.persistState = "saving";
  const p = deriveWorkbenchPresentation(source);
  assert.equal(p.edit.enabled, false); assert.equal(p.preview.enabled, false);
  assert.equal(p.canOpenCurrentHtml, false); assert.equal(p.canReloadCurrentSource, false);
  assert.match(p.actions.saveVersion.reason, /AI 任务/u);
  assert.equal(p.actions.exportHtml.enabled, true);
  assert.match(p.actions.reloadSource.reason, /AI 任务/u);
});

test("menu availability explains review, transition and persistence locks without hiding actions", () => {
  const reviewing = input();
  reviewing.reviewActive = true;
  assert.match(deriveWorkbenchPresentation(reviewing).actions.saveVersion.reason, /采用或不用/u);
  assert.equal(deriveWorkbenchPresentation(reviewing).actions.exportHtml.enabled, true);

  const transitioning = input();
  transitioning.viewTransitioning = true;
  const transition = deriveWorkbenchPresentation(transitioning);
  for (const key of ["saveVersion", "showInFolder", "openInBrowser", "exportHtml", "preservedDrafts", "reloadSource"]) {
    assert.equal(transition.actions[key].enabled, false, key);
    assert.match(transition.actions[key].reason, /切换/u, key);
  }

  const saving = input();
  saving.persistState = "saving";
  saving.editRevision = 2;
  saving.lastPersistedRevision = 1;
  const persistence = deriveWorkbenchPresentation(saving);
  assert.match(persistence.actions.openInBrowser.reason, /保存完成/u);
  assert.match(persistence.actions.reloadSource.reason, /保存完成/u);
  assert.equal(persistence.actions.exportHtml.enabled, true);
});
test("a branching lineage still renders V1 through Vn without mutating input", () => {
  const versions = [{ versionId: "v3", ordinal: 3, basedOnVersionId: "v1" }, { versionId: "v1", ordinal: 1 }, { versionId: "v2", ordinal: 2, basedOnVersionId: "v1" }];
  assert.deepEqual(orderedProjectVersions(versions).map((row) => row.ordinal), [1, 2, 3]);
  assert.deepEqual(versions.map((row) => row.ordinal), [3, 1, 2]);
  assert.equal(versions[0].basedOnVersionId, "v1");
});


test("document-dependent actions require the same target, even with a ready review", () => {
  for (const activeTab of [null, { ...input().activeTab, projectId: "B", documentId: "docB" },
    { ...input().activeTab, documentId: "replacement" }]) {
    const p = deriveWorkbenchPresentation({ ...input(), activeTab, canvasMode: "preview",
      activeRunStatus: "ready-to-open", hasReadyPayload: true });
    assert.equal(p.projectId, null);
    assert.equal(p.selectedVersionId, null);
    for (const action of [p.edit, p.preview, p.review]) {
      assert.equal(action.enabled, false);
      assert.ok(action.reason);
    }
    for (const key of ["canShowInFinder", "canOpenCurrentHtml", "canExportCurrentHtml", "canReloadCurrentSource", "refreshAvailable"]) {
      assert.equal(p[key], false, key);
    }
  }
});

test("a matching unsaved document retains its source export during persistence failure", () => {
  const p = deriveWorkbenchPresentation({ ...input(), persistState: "error",
    editRevision: 4, lastPersistedRevision: 2, workspaceIssue: true });
  assert.equal(p.canExportCurrentHtml, true);
  assert.equal(p.canOpenCurrentHtml, false);
  assert.equal(p.canReloadCurrentSource, false);
});


test("a source-less document is usable only while its tab owns the current runtime", () => {
  const source = { ...input(), project: { projectId: null, documentId: null, sourcePath: null },
    runtimeOwnerTabId: "tabA", version: { ...input().version, versions: [], currentBasedOnVersionId: null, latestVersionId: null } };
  const bound = deriveWorkbenchPresentation(source);
  assert.equal(bound.edit.enabled, true);
  assert.equal(bound.preview.enabled, true);
  assert.equal(bound.canExportCurrentHtml, true);
  assert.equal(bound.canOpenCurrentHtml, false);
  assert.equal(bound.canShowInFinder, false);
  assert.equal(bound.reviewAvailable, false);
  const other = deriveWorkbenchPresentation({ ...source, runtimeOwnerTabId: "tabB" });
  assert.equal(other.edit.enabled, false);
  assert.equal(other.preview.enabled, false);
  assert.equal(other.canExportCurrentHtml, false);
});

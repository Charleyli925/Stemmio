import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkbenchTabsSession,
  projectAppliedEventToWorkbenchTabs,
  reconcileWorkbenchTabsWhenReady,
} from "../app/application/workbench-tabs-session.js";

const a = { projectId: "project_alpha", documentId: "doc_alpha", title: "Alpha" };
const b = { projectId: "project_beta", documentId: "doc_beta", title: "Beta" };

test("tabs deduplicate by durable project and document identity", () => {
  const session = new WorkbenchTabsSession();
  session.bindDocument(a);
  session.bindDocument({ ...a, title: "Alpha renamed" });
  assert.equal(session.snapshot.tabs.filter((tab) => tab.kind === "document").length, 1);
  assert.equal(
    session.snapshot.tabs.find((tab) => tab.kind === "document").title,
    "Alpha renamed",
  );
});

test("opening from the active Start converts only that blank tab in place", () => {
  const session = new WorkbenchTabsSession();
  session.createStart({ focus: true });
  const before = session.snapshot.tabs.length;
  const inactiveStartId = session.snapshot.tabs.find(
    (tab) => tab.kind === "start" && tab.tabId !== session.snapshot.activeTabId,
  ).tabId;
  session.bindDocument(a);
  assert.equal(session.snapshot.tabs.length, before);
  assert.equal(session.snapshot.tabs.some((tab) => tab.tabId === inactiveStartId), true);
  assert.equal(session.snapshot.tabs.find(
    (tab) => tab.tabId === session.snapshot.activeTabId,
  )?.projectId, a.projectId);
  session.bindDocument({ ...a, title: "Alpha renamed" });
  assert.equal(session.snapshot.tabs.filter((tab) => tab.kind === "document").length, 1);
  assert.equal(session.snapshot.tabs.length, before);
});

test("same-batch authoritative project events retain every identity and focus the newest", () => {
  const session = new WorkbenchTabsSession();
  const apply = (project, activeLocked = false) => projectAppliedEventToWorkbenchTabs({
    session,
    event: { type: "project-applied", project, activeLocked },
  });
  apply({ ...a, name: "Alpha.html" });
  apply({ ...a, name: "Alpha renamed.html" });
  apply({ ...b, name: "Beta.html" }, true);

  const documents = session.snapshot.tabs.filter((tab) => tab.kind === "document");
  assert.deepEqual(documents.map((tab) => tab.projectId), [a.projectId, b.projectId]);
  assert.equal(documents[0].title, "Alpha renamed.html");
  assert.equal(documents[1].status, "processing");
  assert.equal(session.snapshot.activeTabId, documents[1].tabId);
  assert.equal(session.snapshot.mountedDocumentTabId, documents[1].tabId);
});

test("missing project-surface titles use the HTML display fallback without changing identity", () => {
  for (const title of [undefined, "", "   "]) {
    const session = new WorkbenchTabsSession();
    session.bindDocument({ ...a, title: "Alpha", focus: true });
    const rules = session.createProjectRules({
      projectId: a.projectId,
      documentId: a.documentId,
      title,
      focus: false,
    });
    const history = session.createHistory({
      projectId: a.projectId,
      documentId: a.documentId,
      title,
      versionId: "ver_0001",
      versionOrdinal: 1,
      focus: false,
    });

    assert.equal(rules.title, "HTML");
    assert.equal(history.title, "HTML");
    assert.equal(rules.tabId, `project-rules:${a.projectId}:${a.documentId}`);
    assert.equal(history.tabId, `history:${a.projectId}:${a.documentId}`);
    assert.equal(session.snapshot.activeTabId, `document:${a.projectId}:${a.documentId}`);
  }
});

test("project-surface title fallback preserves malformed and overlong display rejection", () => {
  const malformedTitles = [123, false, {}, []];
  for (const title of malformedTitles) {
    const session = new WorkbenchTabsSession();
    assert.throws(
      () => session.createProjectRules({ ...a, title }),
      /valid project rules tab identity is required/u,
    );
  }

  const session = new WorkbenchTabsSession();
  assert.throws(
    () => session.createHistory({
      ...a,
      title: "x".repeat(181),
      versionId: "ver_0001",
      versionOrdinal: 1,
    }),
    /valid project history tab identity is required/u,
  );
});

test("late project title updates existing surfaces without adding or focusing a tab", () => {
  const session = new WorkbenchTabsSession();
  session.bindDocument({ ...a, title: "HTML" });
  session.createProjectRules({ ...a, title: "   ", focus: false });
  session.createHistory({
    ...a,
    title: "",
    versionId: "ver_0001",
    versionOrdinal: 1,
    focus: false,
  });
  const activeTabId = session.snapshot.activeTabId;
  const tabCount = session.snapshot.tabs.length;

  session.updateTitle(a.projectId, a.documentId, "Alpha from Registry");

  assert.equal(session.snapshot.tabs.length, tabCount);
  assert.equal(session.snapshot.activeTabId, activeTabId);
  assert.deepEqual(
    session.snapshot.tabs
      .filter((tab) => tab.projectId === a.projectId && tab.documentId === a.documentId)
      .map((tab) => tab.title),
    ["Alpha from Registry", "Alpha from Registry", "Alpha from Registry"],
  );
});

test("late registry titles refresh live rules and history labels without changing focus", () => {
  const session = new WorkbenchTabsSession();
  session.bindDocument({ ...a, title: "Alpha", focus: true });
  session.createProjectRules({ ...a, title: "   ", focus: false });
  session.createHistory({
    ...a,
    title: "",
    versionId: "ver_0001",
    versionOrdinal: 1,
    focus: false,
  });
  const activeTabId = session.snapshot.activeTabId;
  const tabCount = session.snapshot.tabs.length;

  const reconciled = session.reconcileRegisteredProjects([{
    ...a,
    projectName: "Alpha from Registry",
    availability: "ready",
  }]);

  assert.deepEqual(reconciled.missing, []);
  assert.equal(reconciled.snapshot.tabs.length, tabCount);
  assert.equal(reconciled.snapshot.activeTabId, activeTabId);
  assert.deepEqual(
    reconciled.snapshot.tabs
      .filter((tab) => tab.kind === "project-rules" || tab.kind === "history")
      .map((tab) => tab.title),
    ["Alpha from Registry", "Alpha from Registry"],
  );
});

test("AI background status and Candidate adoption remain on the same project document tab", () => {
  const session = new WorkbenchTabsSession();
  session.bindDocument(a);
  const tabId = session.snapshot.activeTabId;
  for (const status of ["processing", "review-ready", "normal"]) {
    session.updateStatus(a.projectId, a.documentId, status);
    assert.equal(session.snapshot.activeTabId, tabId);
    assert.equal(session.snapshot.mountedDocumentTabId, tabId);
    assert.equal(session.snapshot.runtimeOwnerTabId, tabId);
    assert.equal(session.snapshot.tabs.filter((tab) => tab.kind === "document").length, 1);
    assert.equal(session.snapshot.tabs.find((tab) => tab.tabId === tabId).status, status);
  }
  projectAppliedEventToWorkbenchTabs({
    session,
    event: {
      type: "project-applied",
      project: { ...a, name: "Alpha Candidate.html" },
      activeLocked: false,
    },
  });
  assert.equal(session.snapshot.activeTabId, tabId);
  assert.equal(session.snapshot.mountedDocumentTabId, tabId);
  assert.equal(session.snapshot.tabs.filter((tab) => tab.kind === "document").length, 1);
  assert.equal(session.snapshot.tabs.find((tab) => tab.tabId === tabId).title, "Alpha Candidate.html");
});

test("settings is a singleton presentation tab and preserves the document runtime owner", () => {
  const session = new WorkbenchTabsSession();
  session.bindDocument(a);
  const documentTabId = session.snapshot.activeTabId;

  const first = session.createSettings({ focus: true });
  const settingsTab = first;
  assert.ok(settingsTab);
  assert.equal(settingsTab.kind, "settings");
  assert.equal(session.snapshot.activeTabId, settingsTab.tabId);
  assert.equal(session.snapshot.mountedDocumentTabId, null);
  assert.equal(session.snapshot.runtimeOwnerTabId, documentTabId);

  const second = session.createSettings({ focus: true });
  assert.equal(second.tabId, settingsTab.tabId);
  assert.equal(session.snapshot.tabs.filter((tab) => tab.kind === "settings").length, 1);
  assert.equal(session.snapshot.activeTabId, settingsTab.tabId);
  assert.equal(session.snapshot.runtimeOwnerTabId, documentTabId);
});

test("长期规则在项目内去重，并保留 HTML runtime owner", () => {
  const session = new WorkbenchTabsSession();
  session.bindDocument(a);
  const documentTabId = session.snapshot.activeTabId;

  const first = session.createProjectRules({ ...a, focus: true });
  const rulesTab = first;
  assert.ok(rulesTab);
  assert.equal(rulesTab.kind, "project-rules");
  assert.equal(rulesTab.title, "Alpha");
  assert.equal(session.snapshot.activeTabId, rulesTab.tabId);
  assert.equal(session.snapshot.mountedDocumentTabId, null);
  assert.equal(session.snapshot.runtimeOwnerTabId, documentTabId);

  session.beginSwitch(rulesTab.tabId);
  session.commitProjectRules(rulesTab.tabId);
  const second = session.createProjectRules({ ...a, focus: true });
  assert.equal(second.tabId, rulesTab.tabId);
  assert.equal(session.snapshot.tabs.filter((tab) => tab.kind === "project-rules").length, 1);
  assert.equal(session.snapshot.activeTabId, rulesTab.tabId);
  assert.equal(session.snapshot.runtimeOwnerTabId, documentTabId);
  const third = session.createProjectRules({ ...b, focus: true });
  assert.equal(third.kind, "project-rules");
  assert.equal(session.snapshot.tabs.filter((tab) => tab.kind === "project-rules").length, 2);
  assert.match(JSON.stringify(session.serialize()), /project-rules/u);
});

test("历史标签在项目内复用并只在提交后更新所选版本", () => {
  const session = new WorkbenchTabsSession();
  session.bindDocument(a);
  const created = session.createHistory({ ...a, versionId: "ver_1", versionOrdinal: 1, focus: false });
  const reused = session.createHistory({ ...a, versionId: "ver_3", versionOrdinal: 3, focus: false });
  assert.equal(created.kind, "history");
  assert.equal(reused.tabId, created.tabId);
  assert.equal(reused.versionId, "ver_1");
  let history = session.snapshot.tabs.filter((tab) => tab.kind === "history");
  assert.equal(history.length, 1);
  assert.equal(history[0].versionId, "ver_1");
  assert.equal(history[0].versionOrdinal, 1);
  session.beginSwitch(history[0].tabId, { force: true });
  session.commitHistory(history[0].tabId, {
    ...a,
    versionId: "ver_3",
    versionOrdinal: 3,
    versionLabel: "V3",
    displayFileName: "Alpha-V3.html",
  });
  history = session.snapshot.tabs.filter((tab) => tab.kind === "history");
  assert.equal(history[0].versionId, "ver_3");
  assert.equal(history[0].versionOrdinal, 3);
});

test("a Finder rename updates the document tab title without changing its identity", () => {
  const session = new WorkbenchTabsSession();
  session.bindDocument(a);
  const tabId = session.snapshot.activeTabId;
  session.updateTitle(a.projectId, a.documentId, "Alpha renamed.html");
  const tab = session.snapshot.tabs.find((candidate) => candidate.tabId === tabId);
  assert.equal(tab.title, "Alpha renamed.html");
  assert.equal(session.snapshot.activeTabId, tabId);
  assert.equal(session.snapshot.mountedDocumentTabId, tabId);
  assert.equal(session.snapshot.runtimeOwnerTabId, tabId);
});

test("staging a registered project from active Start reuses the blank slot", () => {
  const session = new WorkbenchTabsSession();
  session.createStart({ focus: true });
  const before = session.snapshot.tabs.length;
  const replacedStartId = session.snapshot.activeTabId;
  const staged = session.stageDocument(a);
  assert.ok(staged);
  assert.equal(session.snapshot.tabs.length, before);
  assert.equal(session.snapshot.tabs.some((tab) => tab.tabId === replacedStartId), true);
  assert.equal(session.snapshot.tabs.some((tab) => tab.tabId === staged.tabId), false);
  assert.equal(session.resolveTab(staged.tabId)?.tabId, staged.tabId);
  session.beginSwitch(staged.tabId);
  assert.equal(session.snapshot.pendingTabId, staged.tabId);
  assert.equal(session.snapshot.activeTabId, replacedStartId);
  session.bindDocument({ ...a, title: "Alpha renamed", focus: false });
  session.commitDocument({ ...a, tabId: staged.tabId, title: "Alpha renamed" });
  assert.equal(session.snapshot.activeTabId, staged.tabId);
  assert.equal(session.snapshot.tabs.some((tab) => tab.tabId === replacedStartId), false);
  assert.equal(session.snapshot.tabs.find((tab) => tab.tabId === staged.tabId)?.title, "Alpha renamed");
  assert.equal(session.snapshot.tabs.length, before);
});

test("opening an already represented document from active Start removes the blank and focuses the existing tab", () => {
  const session = new WorkbenchTabsSession();
  session.bindDocument(a);
  session.createStart({ focus: true });
  const before = session.snapshot.tabs.length;
  session.bindDocument({ ...a, title: "Alpha existing" });
  assert.equal(session.snapshot.tabs.length, before - 1);
  assert.equal(session.snapshot.tabs.filter((tab) => tab.kind === "document").length, 1);
  assert.equal(session.snapshot.tabs.find((tab) => tab.tabId === session.snapshot.activeTabId)?.title, "Alpha existing");
});

test("switch is pending until the single mounted controller publishes the document", () => {
  const session = new WorkbenchTabsSession();
  session.bindDocument(a);
  session.bindDocument({ ...b, focus: false });
  const beta = session.snapshot.tabs.find((tab) => tab.projectId === b.projectId);
  session.beginSwitch(beta.tabId);
  assert.equal(session.snapshot.activeTabId.includes("alpha"), true);
  assert.equal(session.snapshot.pendingTabId, beta.tabId);
  session.bindDocument(b);
  assert.equal(session.snapshot.activeTabId, beta.tabId);
  assert.equal(session.snapshot.mountedDocumentTabId, beta.tabId);
});

test("closing the last document enters the start tab without deleting durable facts", () => {
  const session = new WorkbenchTabsSession();
  const document = session.bindDocument(a).tabs.find((tab) => tab.kind === "document");
  const result = session.close(document.tabId);
  assert.equal(result.snapshot.tabs.some((tab) => tab.kind === "document"), false);
  assert.equal(result.snapshot.tabs.some((tab) => tab.kind === "start"), true);
  assert.equal(result.snapshot.mountedDocumentTabId, null);
});

test("serialized state contains identity and presentation only", () => {
  const session = new WorkbenchTabsSession();
  session.bindDocument(a);
  session.createHistory({
    ...a,
    versionId: "ver_0003",
    versionOrdinal: 3,
    versionLabel: "Private V3 label",
    displayFileName: "Private Alpha V3.html",
  });
  const serialized = JSON.stringify(session.serialize());
  assert.match(serialized, /project_alpha/u);
  assert.match(serialized, /ver_0003/u);
  assert.doesNotMatch(serialized, /sourcePath|html|sha256|\/Users\/|Private Alpha|Private V3/u);
});

test("persisted null active identity restores Start without selecting a legacy document", () => {
  const session = new WorkbenchTabsSession();
  session.hydrate({
    version: 1,
    activeTabId: null,
    tabs: [{
      tabId: "document:project_alpha:doc_alpha",
      projectId: "project_alpha",
      documentId: "doc_alpha",
    }],
  });
  assert.equal(session.snapshot.tabs.find(
    (tab) => tab.tabId === session.snapshot.activeTabId,
  )?.kind, "start");
  assert.equal(session.snapshot.pendingTabId, null);
  assert.equal(session.serialize().activeTabId, null);
});

test("restored project-surface titles remain HTML until a real registry title arrives", () => {
  const session = new WorkbenchTabsSession();
  session.hydrate({
    version: 1,
    activeTabId: "project-rules:project_alpha:doc_alpha",
    tabs: [
      {
        tabId: "project-rules:project_alpha:doc_alpha",
        kind: "project-rules",
        projectId: a.projectId,
        documentId: a.documentId,
      },
      {
        tabId: "history:project_alpha:doc_alpha",
        kind: "history",
        projectId: a.projectId,
        documentId: a.documentId,
        versionId: "ver_0001",
        versionOrdinal: 1,
      },
    ],
  });

  assert.deepEqual(
    session.snapshot.tabs
      .filter((tab) => tab.projectId === a.projectId && tab.documentId === a.documentId)
      .map((tab) => tab.title),
    ["HTML", "HTML"],
  );
  const reconciled = session.reconcileRegisteredProjects([{
    ...a,
    projectName: "",
    availability: "ready",
  }]);
  assert.deepEqual(reconciled.missing, []);
  assert.deepEqual(
    reconciled.snapshot.tabs
      .filter((tab) => tab.projectId === a.projectId && tab.documentId === a.documentId)
      .map((tab) => tab.title),
    ["HTML", "HTML"],
  );
});

test("restored document titles are projected from the registry and never persisted", () => {
  const session = new WorkbenchTabsSession();
  session.hydrate({
    version: 1,
    activeTabId: "document:project_alpha:doc_alpha",
    tabs: [
      {
        tabId: "document:project_alpha:doc_alpha",
        projectId: "project_alpha",
        documentId: "doc_alpha",
      },
      {
        tabId: "document:project_beta:doc_beta",
        projectId: "project_beta",
        documentId: "doc_beta",
      },
    ],
  });
  const reconciled = session.reconcileRegisteredProjects([
    { ...a, projectName: "Alpha from registry", availability: "ready" },
    { ...b, projectName: "Beta from registry", availability: "ready" },
  ]);
  assert.deepEqual(
    reconciled.snapshot.tabs.filter((tab) => tab.kind === "document").map((tab) => tab.title),
    ["Alpha from registry", "Beta from registry"],
  );
  assert.deepEqual(reconciled.missing, []);
  assert.doesNotMatch(JSON.stringify(session.serialize()), /Alpha from registry|Beta from registry/u);
});

test("missing restored documents are removed and leave a usable Start tab", () => {
  const session = new WorkbenchTabsSession();
  session.hydrate({
    version: 1,
    activeTabId: "document:project_alpha:doc_alpha",
    tabs: [{
      tabId: "document:project_alpha:doc_alpha",
      projectId: "project_alpha",
      documentId: "doc_alpha",
    }],
  });
  const reconciled = session.reconcileRegisteredProjects([]);
  assert.equal(reconciled.missing.length, 1);
  assert.equal(reconciled.snapshot.tabs.length, 1);
  assert.equal(reconciled.snapshot.tabs[0].kind, "start");
  assert.equal(reconciled.snapshot.activeTabId, reconciled.snapshot.tabs[0].tabId);
  assert.equal(reconciled.snapshot.pendingTabId, null);
  assert.equal(reconciled.snapshot.mountedDocumentTabId, null);
});

test("restore reconciliation is deterministic when catalog readiness arrives first", () => {
  const session = new WorkbenchTabsSession();
  const registeredProjects = [
    { ...a, projectName: "Catalog first", availability: "ready" },
  ];
  assert.equal(reconcileWorkbenchTabsWhenReady({
    session,
    tabsPersistenceReady: false,
    registeredProjectsReady: true,
    registeredProjects,
  }), null);
  session.hydrate({
    version: 1,
    activeTabId: null,
    tabs: [{
      tabId: "document:project_alpha:doc_alpha",
      projectId: "project_alpha",
      documentId: "doc_alpha",
    }],
  });
  const reconciled = reconcileWorkbenchTabsWhenReady({
    session,
    tabsPersistenceReady: true,
    registeredProjectsReady: true,
    registeredProjects,
  });
  assert.equal(reconciled.snapshot.tabs.find((tab) => tab.kind === "document")?.title, "Catalog first");
});

test("restore reconciliation is deterministic when tabs hydration arrives first", () => {
  const session = new WorkbenchTabsSession();
  session.hydrate({
    version: 1,
    activeTabId: null,
    tabs: [{
      tabId: "document:project_alpha:doc_alpha",
      projectId: "project_alpha",
      documentId: "doc_alpha",
    }],
  });
  assert.equal(reconcileWorkbenchTabsWhenReady({
    session,
    tabsPersistenceReady: true,
    registeredProjectsReady: false,
    registeredProjects: [],
  }), null);
  const reconciled = reconcileWorkbenchTabsWhenReady({
    session,
    tabsPersistenceReady: true,
    registeredProjectsReady: true,
    registeredProjects: [],
  });
  assert.equal(reconciled.missing.length, 1);
  assert.equal(reconciled.snapshot.tabs.every((tab) => tab.kind === "start"), true);
});

test("tab order remains identity-deduplicated across many open documents", () => {
  const session = new WorkbenchTabsSession();
  for (let index = 0; index < 40; index += 1) {
    assert.ok(session.bindDocument({
      projectId: `project_unlimited_${index}`,
      documentId: `doc_unlimited_${index}`,
      title: `Unlimited ${index}`,
      focus: index === 0,
    }));
  }
  assert.equal(session.snapshot.tabs.length, 40);
  session.bindDocument({
    projectId: "project_unlimited_39",
    documentId: "doc_unlimited_39",
    title: "Unlimited renamed",
  });
  assert.equal(session.snapshot.tabs.length, 40);
  assert.equal(session.snapshot.tabs.find((tab) => tab.projectId === "project_unlimited_39")?.title, "Unlimited renamed");
});

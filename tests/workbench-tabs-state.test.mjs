import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  normalizeWorkbenchTabsState,
  readWorkbenchTabsState,
  writeWorkbenchTabsState,
} from "../desktop/workbench-tabs-state.mjs";

const valid = {
  version: 2,
  activeTabId: "document:project_alpha:doc_alpha",
  tabs: [{
    tabId: "document:project_alpha:doc_alpha",
    kind: "document",
    projectId: "project_alpha",
    documentId: "doc_alpha",
  }],
};

test("workbench tab persistence accepts presentation identity and rejects authority fields", () => {
  assert.deepEqual(normalizeWorkbenchTabsState(valid), valid);
  assert.equal(normalizeWorkbenchTabsState({
    ...valid,
    tabs: [{ ...valid.tabs[0], sourcePath: "/Users/demo/alpha.html" }],
  }), null);
  assert.equal(normalizeWorkbenchTabsState({ ...valid, activeTabId: "missing" }), null);
});

test("workbench tab persistence accepts many identity-only tabs", () => {
  const tabs = Array.from({ length: 2_048 }, (_, index) => ({
    tabId: `document:project_many_${index}:doc_many_${index}`,
    kind: "document",
    projectId: `project_many_${index}`,
    documentId: `doc_many_${index}`,
  }));
  const state = { version: 2, activeTabId: tabs.at(-1).tabId, tabs };
  assert.deepEqual(normalizeWorkbenchTabsState(state), state);
});

test("workbench tab persistence rejects legacy document tabs and accepts project surfaces", () => {
  const legacy = {
    version: 1,
    activeTabId: "document:project_alpha:doc_alpha",
    tabs: [{
      tabId: "document:project_alpha:doc_alpha",
      projectId: "project_alpha",
      documentId: "doc_alpha",
    }],
  };
  assert.equal(normalizeWorkbenchTabsState(legacy), null);
  const surfaces = {
    version: 2,
    activeTabId: "history:project_alpha:doc_alpha",
    tabs: [
      valid.tabs[0],
      { tabId: "project-rules:project_alpha:doc_alpha", kind: "project-rules", projectId: "project_alpha", documentId: "doc_alpha" },
      { tabId: "history:project_alpha:doc_alpha", kind: "history", projectId: "project_alpha", documentId: "doc_alpha", versionId: "ver_0003", versionOrdinal: 3 },
    ],
  };
  assert.deepEqual(normalizeWorkbenchTabsState(surfaces), surfaces);
  assert.equal(normalizeWorkbenchTabsState({
    ...surfaces,
    tabs: surfaces.tabs.map((tab) => tab.kind === "history"
      ? { ...tab, displayFileName: "private-name.html" }
      : tab),
  }), null);
});

test("workbench tab state is atomically written and malformed state fails visibly closed", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "stemmio-tabs-"));
  await writeWorkbenchTabsState({ userDataPath, state: valid });
  assert.deepEqual(await readWorkbenchTabsState({ userDataPath }), valid);
  const filePath = path.join(userDataPath, "workbench-tabs.json");
  const retired = JSON.stringify({
    version: 1,
    activeTabId: "document:project_alpha:doc_alpha",
    tabs: [{
      tabId: "document:project_alpha:doc_alpha",
      projectId: "project_alpha",
      documentId: "doc_alpha",
    }],
  });
  await writeFile(filePath, retired, "utf8");
  await assert.rejects(readWorkbenchTabsState({ userDataPath }), /无效/u);
  assert.equal(await readFile(filePath, "utf8"), retired);
  await writeFile(filePath, "{not json", "utf8");
  await assert.rejects(readWorkbenchTabsState({ userDataPath }), SyntaxError);
  assert.equal((await readFile(filePath, "utf8")), "{not json");
});

test("concurrent tab projections use distinct atomic temporary files", async () => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "stemmio-tabs-concurrent-"));
  await Promise.all(Array.from({ length: 12 }, () => (
    writeWorkbenchTabsState({ userDataPath, state: valid })
  )));
  assert.deepEqual(await readWorkbenchTabsState({ userDataPath }), valid);
});

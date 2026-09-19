import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  UI_PREFERENCES_SCHEMA_VERSION,
  decodeUiPreferences,
  readUiPreferences,
  recordUiWorkspacePreferences,
  readLastExportDirectory,
  recordLastExportDirectory,
} from "../desktop/ui-preferences.mjs";
import {
  normalizeWorkspacePatch,
} from "../shared/workspace-preferences.mjs";

const DEFAULT_WORKSPACE = {
  rememberPanelWidths: true,
  sidebarWidth: 264,
  inspectorWidth: 376,
  motion: "system",
  restoreTabsOnLaunch: true,
  reviewChangeContextVisibility: 25,
  reviewCommentContextVisibility: 15,
  defaultAgentProviderId: "qoder",
  disabledAgentProviderIds: [],
  agentConfigurations: {},
  documentAgentSelections: {},
};

async function temporaryUserData(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stemmio-ui-pref-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

test("native export directory shares atomic preference writes without renderer path access", async (t) => {
  const userDataPath = await temporaryUserData(t);
  const directoryPath = path.join(userDataPath, "Exports");
  await Promise.all([
    recordLastExportDirectory({ userDataPath, directoryPath }),
    recordUiWorkspacePreferences({ userDataPath, workspace: { sidebarWidth: 320 } }),
  ]);
  assert.equal(await readLastExportDirectory({ userDataPath }), directoryPath);
  const snapshot = await readUiPreferences({ userDataPath });
  assert.equal(snapshot.workspace.sidebarWidth, 320);
  assert.equal("desktop" in snapshot, false);
  assert.throws(() => normalizeWorkspacePatch({ lastExportDirectory: directoryPath }), /未知字段/);
  await recordUiWorkspacePreferences({ userDataPath, workspace: { motion: "reduced" } });
  assert.equal(await readLastExportDirectory({ userDataPath }), directoryPath);
  const persisted = JSON.parse(await readFile(path.join(userDataPath, "ui-preferences.json"), "utf8"));
  assert.deepEqual(persisted.desktop, { lastExportDirectory: directoryPath });
});

test("missing, damaged, and oversized UI preferences use safe workspace defaults", async (t) => {
  const userDataPath = await temporaryUserData(t);
  const missing = await readUiPreferences({ userDataPath });
  assert.equal(missing.schemaVersion, UI_PREFERENCES_SCHEMA_VERSION);
  assert.deepEqual(missing.workspace, DEFAULT_WORKSPACE);

  await writeFile(path.join(userDataPath, "ui-preferences.json"), "{not-json", "utf8");
  assert.deepEqual((await readUiPreferences({ userDataPath })).workspace, DEFAULT_WORKSPACE);

  const oversized = "a".repeat(20 * 1024);
  await writeFile(
    path.join(userDataPath, "ui-preferences.json"),
    JSON.stringify({ schemaVersion: 1, padding: oversized }),
    "utf8",
  );
  assert.deepEqual((await readUiPreferences({ userDataPath })).workspace, DEFAULT_WORKSPACE);
});

test("retired first-edit-guide fields are ignored", () => {
  const decoded = decodeUiPreferences({
    schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
    firstRealHtmlEditGuide: { status: "dismissed", generation: 99 },
    builtInWelcomeProjectId: "project_welcome",
    workspace: { sidebarWidth: 320 },
  });
  assert.equal("firstRealHtmlEditGuide" in decoded, false);
  assert.equal("builtInWelcomeProjectId" in decoded, false);
  assert.equal(decoded.workspace.sidebarWidth, 320);
});

test("unsupported v1 preferences fall back to defaults without rewriting", async (t) => {
  const userDataPath = await temporaryUserData(t);
  await writeFile(path.join(userDataPath, "ui-preferences.json"), JSON.stringify({
    schemaVersion: 1,
    firstRealHtmlEditGuide: {
      key: "first-real-html-edit-guide",
      generation: 2,
      status: "dismissed",
    },
    builtInWelcomeProjectId: "project_legacy_welcome",
  }), "utf8");

  const rejected = await readUiPreferences({ userDataPath });
  assert.equal(rejected.schemaVersion, UI_PREFERENCES_SCHEMA_VERSION);
  assert.deepEqual(rejected.workspace, DEFAULT_WORKSPACE);
  const persisted = await readFile(path.join(userDataPath, "ui-preferences.json"), "utf8");
  assert.match(persisted, /"schemaVersion":1/u);
});

test("an unsupported preference file does not overwrite a concurrent current update", async (t) => {
  const userDataPath = await temporaryUserData(t);
  await writeFile(path.join(userDataPath, "ui-preferences.json"), JSON.stringify({
    schemaVersion: 1,
    firstRealHtmlEditGuide: { status: "presented", generation: 2 },
    builtInWelcomeProjectId: "project_legacy_welcome",
  }), "utf8");

  await readUiPreferences({ userDataPath });
  await recordUiWorkspacePreferences({ userDataPath, workspace: { sidebarWidth: 328 } });
  const final = await readUiPreferences({ userDataPath });
  assert.equal(final.schemaVersion, UI_PREFERENCES_SCHEMA_VERSION);
  assert.equal(final.workspace.sidebarWidth, 328);
});

test("workspace preference decoding clamps damaged values and strict writes reject unsafe patches", () => {
  const decoded = decodeUiPreferences({
    schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
    workspace: {
      sidebarWidth: 999,
      inspectorWidth: 1,
      motion: "unknown",
      restoreTabsOnLaunch: "yes",
      reviewChangeContextVisibility: 999,
      reviewCommentContextVisibility: -10,
      defaultAgentProviderId: "unknown",
    },
  });
  assert.equal(decoded.workspace.sidebarWidth, 420);
  assert.equal(decoded.workspace.inspectorWidth, 280);
  assert.equal(decoded.workspace.motion, "system");
  assert.equal(decoded.workspace.restoreTabsOnLaunch, true);
  assert.equal(decoded.workspace.reviewChangeContextVisibility, 100);
  assert.equal(decoded.workspace.reviewCommentContextVisibility, 0);
  assert.equal(decoded.workspace.defaultAgentProviderId, "qoder");
  assert.deepEqual(decoded.workspace.disabledAgentProviderIds, []);
  assert.throws(() => normalizeWorkspacePatch({ sidebarWidth: 999 }), /范围/u);
  assert.throws(() => normalizeWorkspacePatch({ reviewChangeContextVisibility: 101 }), /范围/u);
  assert.throws(() => normalizeWorkspacePatch({ unknown: true }), /未知字段/u);
  assert.throws(() => normalizeWorkspacePatch({ defaultAgentProviderId: "gemini" }), /默认 Agent/u);
  assert.throws(() => normalizeWorkspacePatch({ disabledAgentProviderIds: ["gemini"] }), /停用的 AI 服务/u);
  assert.equal(normalizeWorkspacePatch({ defaultAgentProviderId: "stemmio" }).defaultAgentProviderId, "stemmio");
  assert.deepEqual(
    normalizeWorkspacePatch({ disabledAgentProviderIds: ["codex", "codex"] }).disabledAgentProviderIds,
    ["codex"],
  );
});

test("provider configurations accept only bounded public choices and preserve the default", async (t) => {
  const userDataPath = await temporaryUserData(t);
  const configurations = { stemmio: { modelId: "stemmio:deepseek-v4-pro", reasoning: "high" } };
  await recordUiWorkspacePreferences({ userDataPath, workspace: { defaultAgentProviderId: "codex" } });
  await recordUiWorkspacePreferences({ userDataPath, workspace: { agentConfigurations: configurations } });
  const persisted = await readUiPreferences({ userDataPath });
  assert.deepEqual(persisted.workspace.agentConfigurations, configurations);
  assert.equal(persisted.workspace.defaultAgentProviderId, "codex");
  for (const unsafe of [
    { stemmio: { ...configurations.stemmio, apiKey: "secret" } },
    { stemmio: { ...configurations.stemmio, modelId: "codex:other-provider" } },
    { stemmio: { ...configurations.stemmio, reasoning: "../../secret" } },
    { other: configurations.stemmio },
  ]) assert.throws(() => normalizeWorkspacePatch({ agentConfigurations: unsafe }), /服务配置无效/u);
});

test("concurrent workspace writes serialize into one v2 document", async (t) => {
  const userDataPath = await temporaryUserData(t);
  await Promise.all([
    recordUiWorkspacePreferences({
      userDataPath,
      workspace: { sidebarWidth: 320, motion: "reduced" },
    }),
    recordUiWorkspacePreferences({
      userDataPath,
      workspace: { defaultAgentProviderId: "codex" },
    }),
  ]);
  const final = await readUiPreferences({ userDataPath });
  assert.equal(final.workspace.sidebarWidth, 320);
  assert.equal(final.workspace.motion, "reduced");
  assert.equal(final.workspace.defaultAgentProviderId, "codex");
});

test("document service choice survives reload separately from the default and disabled services", async (t) => {
  const userDataPath = await temporaryUserData(t);
  const documentAgentSelections = { doc_aaaaaaaaaaaaaaaa: "qoder", doc_bbbbbbbbbbbbbbbb: "codex" };
  await recordUiWorkspacePreferences({ userDataPath, workspace: {
    defaultAgentProviderId: "stemmio", disabledAgentProviderIds: ["qoder"], documentAgentSelections,
  } });
  const restored = await readUiPreferences({ userDataPath });
  assert.deepEqual(restored.workspace.documentAgentSelections, documentAgentSelections);
  assert.equal(restored.workspace.defaultAgentProviderId, "stemmio");
  assert.deepEqual(restored.workspace.disabledAgentProviderIds, ["qoder"]);
  assert.throws(() => normalizeWorkspacePatch({ documentAgentSelections: { "/tmp/private": "codex" } }));
});

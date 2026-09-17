import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkspacePreferencesSession,
} from "../app/application/workspace-preferences-session.js";

const persisted = {
  schemaVersion: 2,
  workspace: {
    rememberPanelWidths: true,
    sidebarWidth: 300,
    inspectorWidth: 410,
    motion: "reduced",
    restoreTabsOnLaunch: false,
    defaultAgentProviderId: "codex",
  },
};

test("workspace preference session loads v2 values and writes narrow patches", async () => {
  const calls = [];
  const session = new WorkspacePreferencesSession({
    port: {
      async get() { return persisted; },
      async record(input) {
        calls.push(input);
        return {
          ...persisted,
          workspace: { ...persisted.workspace, ...input.workspace },
        };
      },
    },
  });
  await session.load();
  assert.equal(session.snapshot.workspace.sidebarWidth, 300);
  assert.equal(session.snapshot.workspace.restoreTabsOnLaunch, false);
  assert.equal(session.snapshot.workspace.defaultAgentProviderId, "codex");
  assert.equal(session.snapshot.workspace.reviewChangeContextVisibility, 25);
  assert.equal(session.snapshot.workspace.reviewCommentContextVisibility, 15);
  assert.equal(session.snapshot.workspace.reviewChangeContextVisibility, 25);
  assert.equal(session.snapshot.workspace.reviewCommentContextVisibility, 15);
  assert.deepEqual(session.snapshot.workspace.disabledAgentProviderIds, []);
  assert.equal(await session.update({ defaultAgentProviderId: "stemmio" }), true);
  assert.deepEqual(calls, [{ workspace: { defaultAgentProviderId: "stemmio" } }]);
  assert.equal(session.snapshot.workspace.defaultAgentProviderId, "stemmio");
  session.dispose();
});

test("the first preference change waits for hydration without losing the optimistic patch", async () => {
  const calls = [];
  let resolveGet;
  const session = new WorkspacePreferencesSession({
    port: {
      get() {
        return new Promise((resolve) => { resolveGet = resolve; });
      },
      async record(input) {
        calls.push(input);
        return {
          ...persisted,
          workspace: { ...persisted.workspace, ...input.workspace },
        };
      },
    },
  });
  const write = session.update({ sidebarWidth: 340 });
  assert.equal(session.snapshot.workspace.sidebarWidth, 340);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 0);
  resolveGet(persisted);
  assert.equal(await write, true);
  assert.deepEqual(calls, [{ workspace: { sidebarWidth: 340 } }]);
  assert.equal(session.snapshot.workspace.sidebarWidth, 340);
  session.dispose();
});

test("a preference write failure stays visible and retry replays the pending patch", async () => {
  let fail = true;
  const session = new WorkspacePreferencesSession({
    port: {
      async get() { return persisted; },
      async record(input) {
        if (fail) throw new Error("disk unavailable");
        return {
          ...persisted,
          workspace: { ...persisted.workspace, ...input.workspace },
        };
      },
    },
  });
  await session.load();
  assert.equal(await session.update({ motion: "system" }), false);
  assert.equal(session.snapshot.saving, false);
  assert.match(session.snapshot.error, /disk unavailable/u);
  fail = false;
  assert.equal(session.retry(), true);
  assert.equal(await session.flush({ deadlineAt: Date.now() + 1_000 }), true);
  assert.equal(session.snapshot.error, null);
  assert.equal(session.snapshot.workspace.motion, "system");
  session.dispose();
});

test("invalid workspace patches are rejected before they reach the port", async () => {
  let writes = 0;
  const session = new WorkspacePreferencesSession({
    port: {
      async get() { return null; },
      async record(input) {
        writes += 1;
        return {
          ...persisted,
          workspace: { ...persisted.workspace, ...input.workspace },
        };
      },
    },
  });
  assert.throws(() => session.update({ sidebarWidth: 999 }), /范围/u);
  assert.throws(() => session.update({ reviewChangeContextVisibility: 101 }), /范围/u);
  assert.throws(() => session.update({ reviewCommentContextVisibility: -1 }), /范围/u);
  assert.throws(() => session.update({ unknown: true }), /未知字段/u);
  assert.throws(() => session.update({ defaultAgentProviderId: "gemini" }), /默认 Agent/u);
  assert.throws(() => session.update({ disabledAgentProviderIds: ["gemini"] }), /停用的 AI 服务/u);
  assert.equal(writes, 0);
  assert.equal(await session.update({ defaultAgentProviderId: "stemmio" }), true);
  assert.equal(await session.update({ disabledAgentProviderIds: ["qoder"] }), true);
  assert.equal(writes, 2);
  assert.deepEqual(session.snapshot.workspace.disabledAgentProviderIds, ["qoder"]);
  session.dispose();
});

test("a disabled default Agent stays preferred and is not persisted as another provider", async () => {
  const {
    resolvePreferredAgentProvider,
    shouldPersistDefaultAgentProvider,
    agentServiceLabel,
  } = await import("../app/application/workspace-agent-preference.js");
  const providers = [
    { providerId: "stemmio", selection: { providerId: "stemmio" } },
    { providerId: "qoder", selection: { providerId: "qoder" } },
    { providerId: "codex", selection: { providerId: "codex" } },
  ];
  const preferred = resolvePreferredAgentProvider({
    defaultAgentProviderId: "stemmio",
    disabledAgentProviderIds: ["stemmio"],
    providers,
  });
  assert.equal(preferred.providerId, "stemmio");
  assert.equal(shouldPersistDefaultAgentProvider({
    storedDefaultId: "stemmio",
    preferredId: "qoder",
    disabledAgentProviderIds: ["stemmio"],
  }), false);
  assert.equal(agentServiceLabel("stemmio"), "内置 AI");
});


test("failed document selection persistence returns a visible failure without changing the default", async () => {
  const session = new WorkspacePreferencesSession({ port: {
    async get() { return persisted; }, async record() { throw new Error("disk unavailable"); },
  } });
  await session.load();
  assert.equal(await session.update({ documentAgentSelections: { doc_aaaaaaaaaaaaaaaa: "qoder" } }), false);
  assert.ok(session.snapshot.error);
  assert.equal(session.snapshot.workspace.defaultAgentProviderId, "codex");
  session.dispose();
});


test("a transient preference failure retries once without losing the current choice", async () => {
  let attempts = 0;
  const session = new WorkspacePreferencesSession({ port: {
    async get() { return persisted; },
    async record(input) {
      if (++attempts === 1) throw new Error("temporary failure");
      return { workspace: { ...persisted.workspace, ...input.workspace } };
    },
  } });
  await session.load();
  assert.equal(await session.update({ defaultAgentProviderId: "stemmio" }), true);
  assert.equal(attempts, 2);
  assert.equal(session.snapshot.error, null);
  assert.equal(session.snapshot.workspace.defaultAgentProviderId, "stemmio");
  session.dispose();
});

test("a superseded default commit restores the prior durable default", async () => {
  let durable = structuredClone(persisted);
  let releaseFirstWrite;
  const firstWrite = new Promise((resolve) => { releaseFirstWrite = resolve; });
  const calls = [];
  const session = new WorkspacePreferencesSession({ port: {
    async get() { return durable; },
    async record(input) {
      calls.push(input);
      if (calls.length === 1) await firstWrite;
      durable = { ...durable, workspace: { ...durable.workspace, ...input.workspace } };
      return durable;
    },
  } });
  await session.load();
  let currentIntent = "intent-a";
  const committing = session.commitDefaultAgent({
    providerId: "stemmio",
    isCurrent: () => currentIntent === "intent-a",
  });
  await new Promise((resolve) => setImmediate(resolve));
  currentIntent = "intent-b";
  releaseFirstWrite();
  assert.deepEqual(await committing, { status: "superseded" });
  assert.deepEqual(calls, [
    { workspace: { defaultAgentProviderId: "stemmio" } },
    { workspace: { defaultAgentProviderId: "codex" } },
  ]);
  assert.equal(durable.workspace.defaultAgentProviderId, "codex");
  assert.equal(session.snapshot.workspace.defaultAgentProviderId, "codex");
  session.dispose();
});

test("concurrent provider access changes preserve both disabled providers", async () => {
  let durable = structuredClone(persisted);
  let releaseFirstWrite;
  const firstWrite = new Promise((resolve) => { releaseFirstWrite = resolve; });
  const calls = [];
  const session = new WorkspacePreferencesSession({ port: {
    async get() { return durable; },
    async record(input) {
      calls.push(input);
      if (calls.length === 1) await firstWrite;
      durable = { ...durable, workspace: { ...durable.workspace, ...input.workspace } };
      return durable;
    },
  } });
  await session.load();
  const disableStemmio = session.setProviderDisabled({ providerId: "stemmio", disabled: true });
  const disableCodex = session.setProviderDisabled({ providerId: "codex", disabled: true });
  await new Promise((resolve) => setImmediate(resolve));
  releaseFirstWrite();
  assert.equal(await disableStemmio, true);
  assert.equal(await disableCodex, true);
  assert.deepEqual(calls.map((call) => call.workspace.disabledAgentProviderIds), [
    ["stemmio"],
    ["stemmio", "codex"],
  ]);
  assert.deepEqual(durable.workspace.disabledAgentProviderIds, ["stemmio", "codex"]);
  session.dispose();
});

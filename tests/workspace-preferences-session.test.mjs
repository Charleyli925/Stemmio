import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  WorkspacePreferencesSession,
} from "../app/application/workspace-preferences-session.js";
import {
  readUiPreferences,
  recordUiWorkspacePreferences,
} from "../desktop/ui-preferences.mjs";

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
    intentId: "intent-a",
    providerId: "stemmio",
    isCurrent: () => currentIntent === "intent-a",
  });
  await new Promise((resolve) => setImmediate(resolve));
  currentIntent = "intent-b";
  releaseFirstWrite();
  assert.deepEqual(await committing, {
    status: "superseded",
    intentId: "intent-a",
    rollback: "confirmed",
  });
  assert.deepEqual(calls, [
    { workspace: { defaultAgentProviderId: "stemmio" } },
    { workspace: { defaultAgentProviderId: "codex" } },
  ]);
  assert.equal(durable.workspace.defaultAgentProviderId, "codex");
  assert.equal(session.snapshot.workspace.defaultAgentProviderId, "codex");
  session.dispose();
});

test("a credential intent reaches the single preferences session and restores superseded configuration", async () => {
  let durable = structuredClone(persisted);
  let releaseWrite;
  const write = new Promise((resolve) => { releaseWrite = resolve; });
  const calls = [];
  const session = new WorkspacePreferencesSession({ port: {
    async get() { return durable; },
    async record(input) {
      calls.push(input);
      if (calls.length === 1) await write;
      durable = { ...durable, workspace: { ...durable.workspace, ...input.workspace } };
      return durable;
    },
  } });
  await session.load();
  let currentIntent = "credential-intent-a";
  const committing = session.commitAgentConfigurations({
    intentId: "credential-intent-a",
    agentConfigurations: {
      stemmio: { modelId: "stemmio:deepseek-v4-pro", reasoning: "high" },
    },
    isCurrent: () => currentIntent === "credential-intent-a",
  });
  await new Promise((resolve) => setImmediate(resolve));
  currentIntent = "remove-intent-b";
  releaseWrite();
  assert.deepEqual(await committing, {
    status: "superseded",
    intentId: "credential-intent-a",
    rollback: "confirmed",
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(durable.workspace.agentConfigurations, {});
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
  const disableStemmio = session.setProviderDisabled({
    intentId: "disable-stemmio",
    providerId: "stemmio",
    disabled: true,
    isCurrent: () => true,
  });
  const disableCodex = session.setProviderDisabled({
    intentId: "disable-codex",
    providerId: "codex",
    disabled: true,
    isCurrent: () => true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  releaseFirstWrite();
  assert.deepEqual(await disableStemmio, {
    status: "committed",
    intentId: "disable-stemmio",
    persistence: "confirmed",
  });
  assert.deepEqual(await disableCodex, {
    status: "committed",
    intentId: "disable-codex",
    persistence: "confirmed",
  });
  assert.deepEqual(calls.map((call) => call.workspace.disabledAgentProviderIds), [
    ["stemmio"],
    ["stemmio", "codex"],
  ]);
  assert.deepEqual(durable.workspace.disabledAgentProviderIds, ["stemmio", "codex"]);
  session.dispose();
});

test("a slow superseded provider-disable write restores the prior durable preference", async () => {
  let durable = structuredClone(persisted);
  let releaseWrite;
  const write = new Promise((resolve) => { releaseWrite = resolve; });
  const calls = [];
  const session = new WorkspacePreferencesSession({ port: {
    async get() { return durable; },
    async record(input) {
      calls.push(input);
      if (calls.length === 1) await write;
      durable = { ...durable, workspace: { ...durable.workspace, ...input.workspace } };
      return durable;
    },
  } });
  await session.load();
  let currentIntent = "disconnect-old";
  const disabling = session.setProviderDisabled({
    intentId: "disconnect-old",
    providerId: "stemmio",
    disabled: true,
    isCurrent: () => currentIntent === "disconnect-old",
  });
  await new Promise((resolve) => setImmediate(resolve));
  currentIntent = "connect-new";
  releaseWrite();
  assert.deepEqual(await disabling, {
    status: "superseded",
    intentId: "disconnect-old",
    rollback: "confirmed",
  });
  assert.deepEqual(calls.map((call) => call.workspace.disabledAgentProviderIds), [
    ["stemmio"],
    [],
  ]);
  assert.deepEqual(durable.workspace.disabledAgentProviderIds, []);
  session.dispose();
});

test("dispose lets started Agent mutations finish only their predetermined rollback", async (t) => {
  const cases = [
    {
      name: "default Agent",
      start(session, isCurrent) {
        return session.commitDefaultAgent({
          intentId: "default-before-dispose",
          providerId: "stemmio",
          isCurrent,
        });
      },
      intentId: "default-before-dispose",
      changed: (workspace) => workspace.defaultAgentProviderId === "stemmio",
      restored: (workspace) => workspace.defaultAgentProviderId === "codex",
    },
    {
      name: "Agent configuration",
      start(session, isCurrent) {
        return session.commitAgentConfigurations({
          intentId: "configuration-before-dispose",
          agentConfigurations: {
            stemmio: { modelId: "stemmio:deepseek-v4-pro", reasoning: "high" },
          },
          isCurrent,
        });
      },
      intentId: "configuration-before-dispose",
      changed: (workspace) => Boolean(workspace.agentConfigurations?.stemmio),
      restored: (workspace) => Object.keys(workspace.agentConfigurations || {}).length === 0,
    },
    {
      name: "provider access",
      start(session, isCurrent) {
        return session.setProviderDisabled({
          intentId: "disconnect-before-dispose",
          providerId: "stemmio",
          disabled: true,
          isCurrent,
        });
      },
      intentId: "disconnect-before-dispose",
      changed: (workspace) => workspace.disabledAgentProviderIds?.includes("stemmio") === true,
      restored: (workspace) => workspace.disabledAgentProviderIds?.length === 0,
    },
  ];

  for (const fixture of cases) {
    await t.test(fixture.name, async () => {
      let durable = structuredClone(persisted);
      let releaseFirstRecord;
      let firstRecordStarted;
      const firstRecord = new Promise((resolve) => { firstRecordStarted = resolve; });
      const firstResponse = new Promise((resolve) => { releaseFirstRecord = resolve; });
      const calls = [];
      const session = new WorkspacePreferencesSession({ port: {
        async get() { return durable; },
        async record(input) {
          calls.push(input);
          durable = { ...durable, workspace: { ...durable.workspace, ...input.workspace } };
          if (calls.length === 1) {
            firstRecordStarted();
            await firstResponse;
          }
          return durable;
        },
      } });
      await session.load();
      let current = true;
      let publications = 0;
      session.subscribe(() => { publications += 1; });
      const mutation = fixture.start(session, () => current);
      await firstRecord;
      assert.equal(fixture.changed(durable.workspace), true);
      current = false;
      session.dispose();
      const publicationsAtDispose = publications;
      assert.equal(await session.update({ sidebarWidth: 320 }), false);
      releaseFirstRecord();
      assert.deepEqual(await mutation, {
        status: "superseded",
        intentId: fixture.intentId,
        rollback: "confirmed",
      });
      assert.equal(fixture.restored(durable.workspace), true);
      assert.equal(calls.length, 2);
      assert.equal(publications, publicationsAtDispose);
    });
  }
});

test("a lost ordinary write response is confirmed by authority without a duplicate record", async () => {
  let durable = structuredClone(persisted);
  let records = 0;
  const session = new WorkspacePreferencesSession({ port: {
    async get() { return durable; },
    async record(input) {
      records += 1;
      durable = { ...durable, workspace: { ...durable.workspace, ...input.workspace } };
      throw new Error("response lost after atomic write");
    },
  } });
  await session.load();
  assert.equal(await session.update({ motion: "system" }), true);
  assert.equal(records, 1);
  assert.equal(durable.workspace.motion, "system");
  assert.equal(session.snapshot.workspace.motion, "system");
  assert.equal(session.snapshot.error, null);
  session.dispose();
});

test("a lost retry response is also reconciled before the patch is left pending", async () => {
  let durable = structuredClone(persisted);
  let records = 0;
  const session = new WorkspacePreferencesSession({ port: {
    async get() { return durable; },
    async record(input) {
      records += 1;
      if (records === 1) throw new Error("first write rejected");
      durable = { ...durable, workspace: { ...durable.workspace, ...input.workspace } };
      throw new Error("retry response lost");
    },
  } });
  await session.load();
  assert.equal(await session.update({ motion: "system" }), true);
  assert.equal(records, 2);
  assert.equal(session.snapshot.workspace.motion, "system");
  assert.equal(session.snapshot.error, null);
  session.dispose();
});

test("a superseded Agent intent does not start a preference write", async () => {
  let records = 0;
  const session = new WorkspacePreferencesSession({ port: {
    async get() { return persisted; },
    async record() { records += 1; return persisted; },
  } });
  assert.deepEqual(await session.commitDefaultAgent({
    intentId: "already-superseded",
    providerId: "stemmio",
    isCurrent: () => false,
  }), {
    status: "superseded",
    intentId: "already-superseded",
    write: "not-started",
  });
  assert.equal(records, 0);
  session.dispose();
});

test("a newer ordinary preference beats the failed patch retained for one retry", async () => {
  let durable = structuredClone(persisted);
  const calls = [];
  let session;
  const port = {
    async get() { return durable; },
    async record(input) {
      calls.push(input);
      if (calls.length === 1) {
        void session.update({ defaultAgentProviderId: "qoder" });
        throw new Error("first write rejected");
      }
      durable = { ...durable, workspace: { ...durable.workspace, ...input.workspace } };
      return durable;
    },
  };
  session = new WorkspacePreferencesSession({ port });
  await session.load();
  assert.equal(await session.update({ defaultAgentProviderId: "stemmio" }), true);
  assert.deepEqual(calls, [
    { workspace: { defaultAgentProviderId: "stemmio" } },
    { workspace: { defaultAgentProviderId: "qoder" } },
  ]);
  assert.equal(durable.workspace.defaultAgentProviderId, "qoder");
  assert.equal(session.snapshot.workspace.defaultAgentProviderId, "qoder");
  session.dispose();
});

test("a newer ordinary write is never overwritten by an older Agent rollback", async () => {
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
  const older = session.commitDefaultAgent({
    intentId: "intent-a",
    providerId: "stemmio",
    isCurrent: () => currentIntent === "intent-a",
  });
  await new Promise((resolve) => setImmediate(resolve));
  currentIntent = "intent-b";
  const newer = session.update({ defaultAgentProviderId: "qoder" });
  releaseFirstWrite();
  assert.equal(await newer, true);
  assert.deepEqual(await older, {
    status: "superseded",
    intentId: "intent-a",
    rollback: "not-needed",
  });
  assert.deepEqual(calls, [
    { workspace: { defaultAgentProviderId: "stemmio" } },
    { workspace: { defaultAgentProviderId: "qoder" } },
  ]);
  assert.equal(durable.workspace.defaultAgentProviderId, "qoder");
  assert.equal(session.snapshot.workspace.defaultAgentProviderId, "qoder");
  session.dispose();
});

test("a lost rollback response is confirmed only when authority shows the restore", async () => {
  let durable = structuredClone(persisted);
  let releaseFirstWrite;
  const firstWrite = new Promise((resolve) => { releaseFirstWrite = resolve; });
  let records = 0;
  const session = new WorkspacePreferencesSession({ port: {
    async get() { return durable; },
    async record(input) {
      records += 1;
      durable = { ...durable, workspace: { ...durable.workspace, ...input.workspace } };
      if (records === 1) await firstWrite;
      if (records === 2) throw new Error("rollback response lost");
      return durable;
    },
  } });
  await session.load();
  let current = true;
  const mutation = session.commitDefaultAgent({
    intentId: "lost-rollback-response",
    providerId: "stemmio",
    isCurrent: () => current,
  });
  await new Promise((resolve) => setImmediate(resolve));
  current = false;
  releaseFirstWrite();
  assert.deepEqual(await mutation, {
    status: "superseded",
    intentId: "lost-rollback-response",
    rollback: "confirmed",
  });
  assert.equal(records, 2);
  assert.equal(durable.workspace.defaultAgentProviderId, "codex");
  session.dispose();
});

test("an unconfirmed rollback remains unknown and does not claim restoration", async () => {
  let durable = structuredClone(persisted);
  let releaseFirstWrite;
  const firstWrite = new Promise((resolve) => { releaseFirstWrite = resolve; });
  let records = 0;
  const session = new WorkspacePreferencesSession({ port: {
    async get() { return durable; },
    async record(input) {
      records += 1;
      if (records === 1) {
        durable = { ...durable, workspace: { ...durable.workspace, ...input.workspace } };
        await firstWrite;
        return durable;
      }
      throw new Error("rollback never reached storage");
    },
  } });
  await session.load();
  let current = true;
  const mutation = session.commitDefaultAgent({
    intentId: "unknown-rollback",
    providerId: "stemmio",
    isCurrent: () => current,
  });
  await new Promise((resolve) => setImmediate(resolve));
  current = false;
  releaseFirstWrite();
  assert.deepEqual(await mutation, {
    status: "unknown",
    intentId: "unknown-rollback",
    phase: "rollback",
    pending: true,
  });
  assert.equal(records, 2);
  assert.equal(durable.workspace.defaultAgentProviderId, "stemmio");
  session.dispose();
});

test("an unconfirmed Agent commit reports an honest pending unknown", async () => {
  let reads = 0;
  const session = new WorkspacePreferencesSession({ port: {
    async get() {
      reads += 1;
      if (reads === 1) return persisted;
      throw new Error("authority unavailable");
    },
    async record() { throw new Error("write response unavailable"); },
  } });
  await session.load();
  assert.deepEqual(await session.commitDefaultAgent({
    intentId: "unknown-commit",
    providerId: "stemmio",
    isCurrent: () => true,
  }), {
    status: "unknown",
    intentId: "unknown-commit",
    phase: "commit",
    pending: true,
  });
  assert.equal(session.snapshot.workspace.defaultAgentProviderId, "stemmio");
  assert.ok(session.snapshot.error);
  session.dispose();
});

test("dispose prevents a queued Agent mutation from starting a write", async () => {
  let durable = structuredClone(persisted);
  let releaseFirstWrite;
  const firstWrite = new Promise((resolve) => { releaseFirstWrite = resolve; });
  const calls = [];
  const session = new WorkspacePreferencesSession({ port: {
    async get() { return durable; },
    async record(input) {
      calls.push(input);
      durable = { ...durable, workspace: { ...durable.workspace, ...input.workspace } };
      if (calls.length === 1) await firstWrite;
      return durable;
    },
  } });
  await session.load();
  let firstCurrent = true;
  const started = session.commitDefaultAgent({
    intentId: "started-before-dispose",
    providerId: "stemmio",
    isCurrent: () => firstCurrent,
  });
  const queued = session.commitDefaultAgent({
    intentId: "queued-before-dispose",
    providerId: "qoder",
    isCurrent: () => true,
  });
  await new Promise((resolve) => setImmediate(resolve));
  firstCurrent = false;
  session.dispose();
  releaseFirstWrite();
  assert.equal((await started).status, "superseded");
  assert.deepEqual(await queued, {
    status: "superseded",
    intentId: "queued-before-dispose",
    write: "not-started",
  });
  assert.deepEqual(calls.map((call) => call.workspace.defaultAgentProviderId), [
    "stemmio",
    "codex",
  ]);
  assert.equal(durable.workspace.defaultAgentProviderId, "codex");
});

test("a confirmed Agent preference survives a real Main persistence reopen", async (t) => {
  const userDataPath = await mkdtemp(path.join(os.tmpdir(), "stemmio-session-pref-"));
  t.after(() => rm(userDataPath, { recursive: true, force: true }));
  const port = {
    get: () => readUiPreferences({ userDataPath }),
    record: ({ workspace }) => recordUiWorkspacePreferences({ userDataPath, workspace }),
  };
  const session = new WorkspacePreferencesSession({ port });
  await session.load();
  assert.deepEqual(await session.commitDefaultAgent({
    intentId: "reopen-default",
    providerId: "stemmio",
    isCurrent: () => true,
  }), {
    status: "committed",
    intentId: "reopen-default",
    persistence: "confirmed",
  });
  session.dispose();

  const reopened = new WorkspacePreferencesSession({ port });
  await reopened.load();
  assert.equal(reopened.snapshot.workspace.defaultAgentProviderId, "stemmio");
  reopened.dispose();
});

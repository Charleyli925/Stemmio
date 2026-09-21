import assert from "node:assert/strict";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { sha256 } from "../bridge/lifecycle-core.mjs";
import { TRUSTED_LOCAL_AGENT_POLICY_VERSION } from "../bridge/agent-bridge-service.mjs";
import { loadExecutionPolicy } from "../bridge/agent/policies/execution-policy.mjs";
import { createBridgeTestEnvironment } from "./helpers/bridge-test-environment.mjs";

const fixtureAgent = fileURLToPath(new URL("./fixtures/qoder-acp-agent.mjs", import.meta.url));

function html(label) {
  return `<!doctype html><html><head><title>${label}</title></head><body><main><h1>${label}</h1></main></body></html>`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

async function assertManagedSourceIdentity(value) {
  assert.equal(await readFile(value.externalSourcePath, "utf8"), value.sourceHtml);
  const managedSourceHtml = await readFile(value.ensured.sourcePath, "utf8");
  assert.notEqual(managedSourceHtml, value.sourceHtml);
  const managedSourceIds = [...managedSourceHtml.matchAll(
    /data-stemmio-id="(sm1_[0-9a-f]{32})"/gu,
  )].map((match) => match[1]);
  assert.equal(managedSourceIds.length, 6);
  assert.equal(new Set(managedSourceIds).size, managedSourceIds.length);
  assert.equal(value.ensured.importSourceSha256, sha256(Buffer.from(value.sourceHtml)));
  assert.equal(value.ensured.sourceSha256, sha256(Buffer.from(managedSourceHtml)));
}

async function createCommand(environment, { hang = false, pidFile = null } = {}) {
  const command = path.join(environment.root, hang ? "qoder-hang" : "qoder-complete");
  const argumentsText = [
    hang ? "--hang" : null,
    pidFile ? `--pid-file=${pidFile}` : null,
  ].filter(Boolean).map(shellQuote).join(" ");
  await writeFile(
    command,
    `#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(fixtureAgent)} ${argumentsText} "$@"\n`,
    { encoding: "utf8", mode: 0o755 },
  );
  await chmod(command, 0o755);
  return command;
}

async function createManagedRequest(t, { hang = false } = {}) {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: hang ? "stemmio-agent-cancel-" : "stemmio-agent-complete-",
  });
  const pidFile = path.join(environment.root, "agent.pid");
  const command = await createCommand(environment, { hang, pidFile });
  const sourceHtml = html(hang ? "Cancel ACP" : "Complete ACP");
  const externalSourcePath = await environment.createSource("agent.html", sourceHtml);
  const bridge = await environment.start({
    STEMMIO_PROJECT_FILES_ROOT: path.join(environment.root, "project-files"),
    STEMMIO_E2E: "1",
    STEMMIO_QODER_ACP_ALLOW_TEST_COMMAND: "1",
    STEMMIO_QODER_ACP_COMMAND: command,
  });
  const workspace = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(externalSourcePath)}`,
  );
  const ensured = await bridge.postJson("/project/ensure", {
    sourcePath: externalSourcePath,
    expectedSourceSha256: workspace.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));
  const unknownRequest = await bridge.postJson("/request", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    expectedSourceSha256: ensured.body.sourceSha256,
    freezeCutoffRevision: 0,
    summary: "must not publish",
    comments: [{
      commentId: "comment_unknown_provider",
      text: "must not publish",
      target: { targetId: "target_unknown_provider" },
      attachments: [],
    }],
    targets: [{ targetId: "target_unknown_provider" }],
    changeEvents: [],
    agentDelivery: {
      mode: "managed-agent",
      selection: {
        providerId: "future-agent",
        runtimeId: "future-runtime",
        requestedModelId: null,
        resolvedModelId: null,
        reasoning: { requested: null, applied: null, resolution: "provider-default" },
      },
      trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    },
  });
  assert.equal(unknownRequest.response.status, 422, JSON.stringify(unknownRequest.body));
  assert.equal(unknownRequest.body.error.code, "AGENT_PROVIDER_UNSUPPORTED");
  const afterUnknown = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}`,
  );
  assert.equal(afterUnknown.body.activeRun, null);
  const missingAvailability = await bridge.requestJson("/agent/availability");
  assert.equal(missingAvailability.response.status, 400, JSON.stringify(missingAvailability.body));
  assert.equal(missingAvailability.body.error.code, "AGENT_SELECTION_REQUIRED");
  const selectedAvailability = await bridge.requestJson(
    `/agent/availability?selection=${encodeURIComponent(JSON.stringify({
      providerId: "qoder",
      runtimeId: "acp",
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: { requested: null, applied: null, resolution: "provider-default" },
    }))}`,
  );
  assert.equal(selectedAvailability.response.status, 200, JSON.stringify(selectedAvailability.body));
  assert.equal(selectedAvailability.body.status, "ready");
  const diagnosis = await bridge.requestJson(
    `/agent/diagnose?selection=${encodeURIComponent(JSON.stringify({
      providerId: "qoder",
      runtimeId: "acp",
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: { requested: null, applied: null, resolution: "provider-default" },
    }))}`,
  );
  assert.equal(diagnosis.response.status, 200, JSON.stringify(diagnosis.body));
  assert.deepEqual(Object.keys(diagnosis.body.diagnostic).sort(), [
    "activeInstallation",
    "cause",
    "checkedAt",
    "diagnosticId",
    "facts",
    "operation",
    "readiness",
  ]);
  assert.equal(diagnosis.body.diagnostic.readiness, "ready");
  assert.equal(diagnosis.body.diagnostic.operation, "diagnose");
  assert.deepEqual(Object.keys(diagnosis.body.diagnostic.facts).sort(), [
    "authentication",
    "installation",
    "protocol",
    "service",
  ]);
  assert.equal("command" in diagnosis.body, false);
  assert.equal(JSON.stringify(diagnosis.body).includes("stderr"), false);
  assert.equal(JSON.stringify(diagnosis.body).includes("index.js"), false);
  const unknownAvailability = await bridge.requestJson(
    `/agent/availability?selection=${encodeURIComponent(JSON.stringify({
      providerId: "future-agent",
      runtimeId: "future-runtime",
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: { requested: null, applied: null, resolution: "provider-default" },
    }))}`,
  );
  assert.equal(unknownAvailability.response.status, 400, JSON.stringify(unknownAvailability.body));
  assert.equal(unknownAvailability.body.error.code, "AGENT_PROVIDER_UNSUPPORTED");
  const driverOnly = await bridge.postJson("/agent/preflight", {
    driver: "qoder-acp",
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
  assert.equal(driverOnly.response.status, 400, JSON.stringify(driverOnly.body));
  assert.equal(driverOnly.body.error.code, "AGENT_SELECTION_UNSUPPORTED");
  const preflight = await bridge.postJson("/agent/preflight", {
    selection: {
      providerId: "qoder",
      runtimeId: "acp",
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: { requested: null, applied: null, resolution: "provider-default" },
    },
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
  assert.equal(preflight.response.status, 200, JSON.stringify(preflight.body));
  assert.equal(preflight.body.status, "ready");
  assert.equal("command" in preflight.body, false);
  const request = await bridge.postJson("/request", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    expectedSourceSha256: ensured.body.sourceSha256,
    freezeCutoffRevision: 0,
    summary: "完成受管 Qoder ACP 测试任务",
    comments: [{
      commentId: "comment_managed_qoder",
      text: "完成受管 Qoder ACP 测试任务",
      target: { targetId: "target_managed_qoder" },
      attachments: [],
    }],
    targets: [{ targetId: "target_managed_qoder" }],
    changeEvents: [],
    agentDelivery: {
      mode: "managed-agent",
      selection: preflight.body.selection,
      trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      configuration: preflight.body.configuration,
    },
  });
  assert.equal(request.response.status, 201, JSON.stringify(request.body));
  await loadExecutionPolicy({
    requestPath: request.body.activeRun.requestPath,
    promptPath: request.body.activeRun.promptPath,
    outputPath: request.body.activeRun.outputPath,
    completionPath: request.body.activeRun.completionPath,
  });
  const started = await bridge.postJson("/agent/start", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    requestId: request.body.requestId,
    attemptId: request.body.attemptId,
    selection: preflight.body.selection,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: preflight.body.preflightId,
    configurationDigest: preflight.body.configuration.configurationDigest,
  });
  assert.equal(started.response.status, 202, JSON.stringify(started.body));
  return {
    bridge,
    environment,
    ensured: ensured.body,
    request: request.body,
    sourceHtml,
    externalSourcePath,
    pidFile,
    qoderCommand: command,
  };
}

async function waitForStatus(value, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    latest = await value();
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for status: ${JSON.stringify(latest?.body)}`);
}

test("workspace Agent Bridge completes Qoder ACP into pending review without adopting HTML", async (t) => {
  const value = await createManagedRequest(t);
  const statusPath = `/status?sourcePath=${encodeURIComponent(value.ensured.sourcePath)}`
    + `&requestId=${encodeURIComponent(value.request.requestId)}`
    + `&attemptId=${encodeURIComponent(value.request.attemptId)}`;
  const ready = await waitForStatus(
    () => value.bridge.requestJson(statusPath),
    // Finalizer readiness can precede provider cleanup and history flushing.
    // This assertion covers both facts, so wait for both authoritative states.
    (result) => result.response.status === 200 && result.body.status === "ready-to-open"
      && result.body.agentSession?.state === "completed",
  );
  assert.equal(ready.body.agentSession.providerId, "qoder");
  assert.equal(ready.body.agentSession.runtimeId, "acp");
  assert.equal(ready.body.agentSession.state, "completed");
  assert.equal(ready.body.activeRun.agentDelivery.mode, "managed-agent");
  assert.equal(ready.body.activeRun.agentDelivery.selection.providerId, "qoder");
  assert.equal(ready.body.activeRun.agentDelivery.selection.runtimeId, "acp");
  await assertManagedSourceIdentity(value);

  const candidate = await value.bridge.requestJson(
    `/version-file?sourcePath=${encodeURIComponent(value.ensured.sourcePath)}`
    + `&versionId=${encodeURIComponent(ready.body.versionId)}`,
  );
  assert.equal(candidate.response.status, 200, JSON.stringify(candidate.body));
  assert.match(candidate.body.content, /data-stemmio-qoder-acp="e2e"/u);
  assert.equal(candidate.body.sha256, sha256(Buffer.from(candidate.body.content)));

  const workspace = await value.bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(value.ensured.sourcePath)}`,
  );
  assert.equal(workspace.body.currentExactVersionId, value.ensured.currentExactVersionId);
  assert.equal(workspace.body.runtimeState.activeRun.status, "ready-to-open");
});

test("workspace cancellation stops Qoder before cancelling the durable Request", async (t) => {
  const value = await createManagedRequest(t, { hang: true });
  const pid = Number(await waitForStatus(
    async () => {
      try {
        return { body: { pid: await readFile(value.pidFile, "utf8") } };
      } catch {
        return { body: null };
      }
    },
    (result) => Boolean(result.body?.pid),
  ).then((result) => result.body.pid));
  assert.equal(Number.isSafeInteger(pid), true);

  const cancelled = await value.bridge.postJson("/active-run/cancel", {
    projectId: value.ensured.projectId,
    documentId: value.ensured.documentId,
    sourcePath: value.ensured.sourcePath,
    requestId: value.request.requestId,
    attemptId: value.request.attemptId,
    reason: "agent-bridge-test",
  });
  assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.status, "cancelled");
  await waitForStatus(
    async () => {
      try {
        process.kill(pid, 0);
        return { body: { running: true } };
      } catch (error) {
        if (error?.code === "ESRCH") return { body: { running: false } };
        throw error;
      }
    },
    (result) => result.body.running === false,
  );
  await assertManagedSourceIdentity(value);
  const workspace = await value.bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(value.ensured.sourcePath)}`,
  );
  assert.equal(workspace.body.runtimeState.activeRun, null);
});

test("Bridge crash fences an interrupted Qoder Request from restart and clipboard fallback", async (t) => {
  if (process.platform === "win32") {
    t.skip("detached process-group crash fencing is a POSIX product boundary");
    return;
  }
  const value = await createManagedRequest(t, { hang: true });
  const orphanPid = Number(await waitForStatus(
    async () => {
      try {
        return { body: { pid: await readFile(value.pidFile, "utf8") } };
      } catch {
        return { body: null };
      }
    },
    (result) => Boolean(result.body?.pid),
  ).then((result) => result.body.pid));
  t.after(() => {
    try {
      process.kill(-orphanPid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  });
  const crashed = new Promise((resolve) => value.bridge.child.once("exit", resolve));
  value.bridge.child.kill("SIGKILL");
  await crashed;

  const retryCommand = await createCommand(value.environment);
  const restarted = await value.environment.start({
    STEMMIO_PROJECT_FILES_ROOT: path.join(value.environment.root, "project-files"),
    STEMMIO_E2E: "1",
    STEMMIO_QODER_ACP_ALLOW_TEST_COMMAND: "1",
    STEMMIO_QODER_ACP_COMMAND: retryCommand,
  });
  const statusPath = `/status?sourcePath=${encodeURIComponent(value.ensured.sourcePath)}`
    + `&requestId=${encodeURIComponent(value.request.requestId)}`
    + `&attemptId=${encodeURIComponent(value.request.attemptId)}`;
  const interrupted = await restarted.requestJson(statusPath);
  assert.equal(interrupted.response.status, 200, JSON.stringify(interrupted.body));
  assert.equal(interrupted.body.status, "processing");
  assert.equal(interrupted.body.agentSession.state, "interrupted");
  assert.equal(interrupted.body.agentSession.retryable, false);
  assert.equal(
    interrupted.body.agentSession.errorCode,
    "AGENT_RESTART_RECOVERY_REQUIRED",
  );

  const preflight = await restarted.postJson("/agent/preflight", {
    selection: {
      providerId: "qoder",
      runtimeId: "acp",
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: { requested: null, applied: null, resolution: "provider-default" },
    },
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
  const retried = await restarted.postJson("/agent/start", {
    projectId: value.ensured.projectId,
    documentId: value.ensured.documentId,
    sourcePath: value.ensured.sourcePath,
    requestId: value.request.requestId,
    attemptId: value.request.attemptId,
    selection: preflight.body.selection,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: preflight.body.preflightId,
    configurationDigest: preflight.body.configuration.configurationDigest,
  });
  assert.equal(retried.response.status, 409, JSON.stringify(retried.body));
  assert.equal(retried.body.error.code, "AGENT_DELIVERY_NOT_AUTHORIZED");

  const cancelled = await restarted.postJson("/active-run/cancel", {
    projectId: value.ensured.projectId,
    documentId: value.ensured.documentId,
    sourcePath: value.ensured.sourcePath,
    requestId: value.request.requestId,
    attemptId: value.request.attemptId,
    reason: "bridge-crash-fence-test",
  });
  assert.equal(cancelled.response.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.status, "cancelled");
  const requestsRoot = path.join(
    value.ensured.projectRoot,
    ".stemmio",
    "requests",
  );
  const requestDirectories = await readdir(requestsRoot);
  assert.equal(requestDirectories.filter((name) => name.startsWith("req_")).length, 1);
  await assertManagedSourceIdentity(value);
});

test("public Agent catalog exposes installable Qoder and Codex without paths", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "stemmio-agent-catalog-",
  });
  const home = path.join(environment.root, "home");
  const bin = path.join(environment.root, "bin");
  await mkdir(home, { recursive: true });
  await mkdir(bin, { recursive: true });
  const bridge = await environment.start({
    STEMMIO_AGENTS_ROOT: path.join(environment.root, "agents"),
    HOME: home,
    PATH: bin,
    NPM_CONFIG_PREFIX: path.join(environment.root, "missing-prefix"),
    STEMMIO_E2E: "1",
    STEMMIO_AGENT_INSTALL_STUB_FETCH: "1",
  });
  const listed = await bridge.requestJson("/agent/providers");
  assert.equal(listed.response.status, 200, JSON.stringify(listed.body));
  const stemmio = listed.body.providers.find((item) => item.providerId === "stemmio");
  const qoder = listed.body.providers.find((item) => item.providerId === "qoder");
  const codex = listed.body.providers.find((item) => item.providerId === "codex");
  const serialized = JSON.stringify(listed.body);
  assert.equal(stemmio.installable, false);
  assert.equal(stemmio.runtimeId, "http");
  assert.equal(qoder.installable, true);
  assert.equal(codex.installable, true);
  assert.equal(codex.runtimeId, "acp");
  assert.equal(qoder.installSource, "none");
  assert.equal(qoder.installState, "idle");
  assert.equal(serialized.includes(environment.root), false);
  assert.equal(serialized.includes("command"), false);
  assert.equal(serialized.includes("stderr"), false);
  const unknownInstall = await bridge.postJson("/agent/install", { providerId: "unknown-agent" });
  assert.equal(unknownInstall.response.status, 404, JSON.stringify(unknownInstall.body));
  assert.equal(unknownInstall.body.error.code, "AGENT_PROVIDER_UNSUPPORTED");
  const stemmioLogin = await bridge.postJson("/agent/login", { providerId: "stemmio" });
  assert.equal(stemmioLogin.body.error?.code, "AGENT_LOGIN_UNSUPPORTED");
  const qoderLogin = await bridge.postJson("/agent/login", { providerId: "qoder" });
  assert.equal(qoderLogin.response.status, 202, JSON.stringify(qoderLogin.body));
  assert.equal(qoderLogin.body.ok, true);
  assert.equal(qoderLogin.body.generation, 1);
  assert.equal(qoderLogin.body.activeOperation?.kind, "login");
  assert.equal(qoderLogin.body.activeOperation?.generation, 1);
  const cancelledLogin = await bridge.postJson("/agent/login/cancel", { providerId: "qoder" });
  assert.equal(cancelledLogin.response.status, 200, JSON.stringify(cancelledLogin.body));
  const loginUrl = await bridge.requestJson("/agent/login/url?providerId=qoder");
  assert.equal(loginUrl.response.status, 200, JSON.stringify(loginUrl.body));
  assert.equal(loginUrl.body.loginUrl, null);
  const codexInstall = await bridge.postJson("/agent/install", { providerId: "codex" });
  assert.notEqual(codexInstall.response.status, 404, JSON.stringify(codexInstall.body));
  assert.notEqual(codexInstall.body.error?.code, "AGENT_PROVIDER_UNSUPPORTED");
});

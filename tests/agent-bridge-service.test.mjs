import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AgentBridgeError,
  AgentBridgeService,
  resolveQoderAcpCommand,
  TRUSTED_LOCAL_AGENT_POLICY_VERSION,
} from "../bridge/agent-bridge-service.mjs";
import { defaultManagedAgentDelivery } from "../shared/agent-delivery.mjs";
import {
  cancelDurableRequestAfterAgentCleanup,
  closeWorkspaceBridgeAfterAgentCleanup,
} from "../bridge/workspace-bridge-shutdown.mjs";

const IDENTITY = Object.freeze({
  projectId: `project_${"a".repeat(16)}`,
  documentId: `doc_${"b".repeat(16)}`,
  requestId: "req_agent_bridge_001",
  attemptId: "attempt_001",
  sourcePath: "/tmp/stemmio-agent-bridge.html",
});
const QODER_SELECTION = defaultManagedAgentDelivery().selection;

async function createFakeCommand(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "stemmio-agent-service-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const command = path.join(root, "fake-qoder.mjs");
  await writeFile(command, `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write("1.1.27\\n");
  process.exit(0);
}
if (process.argv.includes("--list-models")) {
  process.stdout.write("MODEL\\nSynthetic-Qoder\\n");
  process.exit(0);
}
if (process.argv.includes("--acp")) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
    for (;;) {
      const newline = input.indexOf("\\n");
      if (newline < 0) break;
      const line = input.slice(0, newline);
      input = input.slice(newline + 1);
      if (!line.trim()) continue;
      const request = JSON.parse(line);
      const result = request.method === "initialize"
        ? { protocolVersion: 1, agentCapabilities: { loadSession: false }, authMethods: [], agentInfo: { name: "stemmio-e2e-qoder", version: "1.1.27" } }
        : request.method === "session/new"
          ? { sessionId: "session_preflight" }
          : null;
      if (request.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
    }
  });
} else {
  process.stderr.write("unexpected command\\n");
  process.exit(2);
}
`, { encoding: "utf8", mode: 0o755 });
  await chmod(command, 0o755);
  return command;
}

async function createFailingCommand(t, stderr) {
  const root = await mkdtemp(path.join(os.tmpdir(), "stemmio-agent-preflight-failure-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const command = path.join(root, "fake-qoder.mjs");
  await writeFile(command, `#!/usr/bin/env node
process.stderr.write(${JSON.stringify(`${stderr}\n`)});
process.exit(1);
`, { encoding: "utf8", mode: 0o755 });
  await chmod(command, 0o755);
  return command;
}

async function createVerifiedNpmCommand(t, {
  manifestVersion = "1.1.27",
  reportedVersion = "1.1.27",
  models = ["Finder-Sparse-Path"],
  launcherRelativePath = [".npm-global", "bin"],
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "stemmio-agent-npm-command-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const packageRoot = path.join(
    root,
    "lib",
    "node_modules",
    "@qoder-ai",
    "qodercli",
  );
  const bundleDirectory = path.join(packageRoot, "bundle");
  const bundle = path.join(bundleDirectory, "qodercli.js");
  const binDirectory = launcherRelativePath
    ? path.join(home, ...launcherRelativePath)
    : null;
  await mkdir(bundleDirectory, { recursive: true });
  if (binDirectory) await mkdir(binDirectory, { recursive: true });
  await writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
    name: "@qoder-ai/qodercli",
    version: manifestVersion,
    bin: { qodercli: "bundle/qodercli.js" },
  }, null, 2)}\n`);
  await writeFile(bundle, `#!/usr/bin/env node
if (process.argv.includes("--version")) {
  process.stdout.write(${JSON.stringify(`${reportedVersion}\n`)});
  process.exit(0);
}
if (process.argv.includes("--list-models")) {
  process.stdout.write(${JSON.stringify(`MODEL\n${models.join("\n")}${models.length ? "\n" : ""}`)});
  process.exit(0);
}
if (process.argv.includes("--acp")) {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    input += chunk;
    for (;;) {
      const newline = input.indexOf("\\n");
      if (newline < 0) break;
      const line = input.slice(0, newline);
      input = input.slice(newline + 1);
      if (!line.trim()) continue;
      const request = JSON.parse(line);
      const result = request.method === "initialize"
        ? { protocolVersion: 1, agentCapabilities: { loadSession: false }, authMethods: [], agentInfo: { name: "qoder-synthetic-agent", version: ${JSON.stringify(manifestVersion)} } }
        : request.method === "session/new"
          ? { sessionId: "session_preflight" }
          : null;
      if (request.id !== undefined) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
    }
  });
} else {
  process.exit(2);
}
`, { encoding: "utf8", mode: 0o755 });
  await chmod(bundle, 0o755);
  const launcher = binDirectory ? path.join(binDirectory, "qodercli") : null;
  if (launcher) await symlink(bundle, launcher);
  return { root, home, bundle, launcher };
}

const preflightTickets = new WeakMap();

function taskAuthority(identity = IDENTITY, ticket = null) {
  return {
    run: {
      ...identity,
      status: "processing",
      requestPath: "/tmp/request",
      promptPath: "/tmp/request/PROMPT.md",
      outputPath: "/tmp/request/attempts/attempt_001/output/candidate.html",
      completionPath: "/tmp/request/attempts/attempt_001/completion.json",
    },
    request: {
      request: {
        agentDelivery: {
          mode: "managed-agent",
          selection: ticket?.selection || {
            providerId: "qoder",
            runtimeId: "acp",
            requestedModelId: null,
            resolvedModelId: null,
            reasoning: {
              requested: null,
              applied: null,
              resolution: "provider-default",
            },
          },
          configuration: ticket?.configuration || null,
          trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
        },
      },
    },
  };
}

function fakePolicy() {
  return {
    manifestPath: "/tmp/request/input-manifest.json",
    promptPath: "/tmp/request/PROMPT.md",
    outputPath: "/tmp/request/attempts/attempt_001/output/candidate.html",
    finalizer: {
      command: process.execPath,
      args: ["/tmp/finalize-attempt.mjs"],
      cwd: "/tmp/request",
      env: {},
    },
  };
}

async function preflight(service) {
  const ticket = await service.preflight({
    selection: QODER_SELECTION,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
  });
  preflightTickets.set(service, ticket);
  return ticket;
}

function createService(command, overrides = {}) {
  const { resolveTask, ...serviceOverrides } = overrides;
  let service;
  service = new AgentBridgeService({
    environment: {
      ...process.env,
      STEMMIO_E2E: "1",
      STEMMIO_QODER_ACP_ALLOW_TEST_COMMAND: "1",
      STEMMIO_QODER_ACP_COMMAND: command,
    },
    resolveTask: async (identity) => resolveTask
      ? resolveTask(identity, preflightTickets.get(service))
      : taskAuthority(identity, preflightTickets.get(service)),
    policyLoader: async () => fakePolicy(),
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ path: "memory-agent-lease", ownerToken }),
      release: async () => true,
    },
    ...serviceOverrides,
  });
  return service;
}

async function waitForState(service, state, identity = IDENTITY) {
  for (let index = 0; index < 50; index += 1) {
    const current = service.status(identity);
    if (current?.state === state) return current;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return service.status(identity);
}

test("Agent Bridge preflight is explicit, bounded, and consumed by one Qoder task", async (t) => {
  const command = await createFakeCommand(t);
  let resolveRun;
  const observed = { calls: 0, prompt: "", expectedExecutable: null };
  const service = createService(command, {
    runTask: ({ prompt, onEvent, expectedExecutable }) => {
      observed.calls += 1;
      observed.prompt = prompt;
      observed.expectedExecutable = expectedExecutable;
      onEvent({ kind: "initialized", agentName: "stemmio-e2e-qoder", agentVersion: "1.1.27" });
      onEvent({ kind: "file-read", role: "prompt" });
      return new Promise((resolve) => {
        resolveRun = resolve;
      });
    },
  });
  t.after(() => service.dispose());

  await assert.rejects(
    service.preflight({ selection: QODER_SELECTION }),
    (error) => error?.code === "AGENT_TRUST_POLICY_REQUIRED",
  );
  const ticket = await preflight(service);
  assert.equal(ticket.status, "ready");
  assert.equal(ticket.agentVersion, "1.1.27");
  assert.equal(ticket.modelCount, 1);
  assert.equal("command" in ticket, false);

  const started = await service.submit({
    ...IDENTITY,
    selection: QODER_SELECTION,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest,
  });
  assert.equal(started.accepted, true);
  assert.equal(started.session.state, "starting");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.status(IDENTITY).state, "running");
  assert.equal(service.status(IDENTITY).phase, "reading-task");
  assert.equal(observed.calls, 1);
  assert.match(observed.prompt, /Candidate pending Stemmio review/u);
  assert.equal(observed.prompt.includes("/tmp/request"), true);
  assert.equal(observed.expectedExecutable.path, await realpath(command));
  assert.match(observed.expectedExecutable.identity.sha256, /^sha256:[a-f0-9]{64}$/u);

  const duplicate = await service.submit({
    ...IDENTITY,
    selection: QODER_SELECTION,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: "not-used-for-idempotent-session",
  });
  assert.equal(duplicate.idempotent, true);
  assert.equal(observed.calls, 1);

  resolveRun({ stopReason: "end_turn" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(service.status(IDENTITY).state, "completed");
  assert.equal(service.status(IDENTITY).phase, "preparing-review");
});

test("verified npm Qoder uses the trusted runtime under Finder's sparse PATH", async (t) => {
  const fixture = await createVerifiedNpmCommand(t);
  const environment = {
    HOME: fixture.home,
    PATH: "/usr/bin:/bin",
  };
  let observed = null;
  let service;
  service = new AgentBridgeService({
    environment,
    commandResolver: ({ environment: commandEnvironment }) => resolveQoderAcpCommand({
      environment: commandEnvironment,
      homeDirectory: fixture.home,
    }),
    resolveTask: async () => taskAuthority(IDENTITY, preflightTickets.get(service)),
    policyLoader: async () => fakePolicy(),
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ path: "memory-agent-lease", ownerToken }),
      release: async () => true,
    },
    runTask: async (input) => {
      observed = input;
      return { stopReason: "end_turn" };
    },
  });
  t.after(() => service.dispose());

  const ticket = await preflight(service);
  assert.equal(ticket.agentVersion, "1.1.27");
  assert.equal(ticket.modelCount, 1);
  assert.equal("command" in ticket, false);
  await service.submit({
    ...IDENTITY,
    selection: QODER_SELECTION,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest,
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(observed.useVerifiedJavaScriptRuntime, true);
  assert.equal(observed.expectedExecutable.path, await realpath(fixture.bundle));
  assert.equal(observed.baseEnvironment.PATH, "/usr/bin:/bin");
});

test("local availability reads installation identity without running Qoder", async (t) => {
  const command = await createFakeCommand(t);
  let preflightCalls = 0;
  const service = createService(command, {
    preflightRunner: async () => {
      preflightCalls += 1;
      return { version: "1.1.27", modelCount: 1 };
    },
  });
  t.after(() => service.dispose());

  const availability = await service.availability({ selection: QODER_SELECTION });

  assert.deepEqual(availability, {
    ok: true,
    status: "ready",
  });
  assert.equal(preflightCalls, 0);
  assert.equal("command" in availability, false);
  assert.equal("version" in availability, false);
  assert.equal("path" in availability, false);
});

test("local availability re-reads disk after Qoder CLI is installed", async (t) => {
  const fixture = await createVerifiedNpmCommand(t);
  await unlink(fixture.launcher);
  const service = new AgentBridgeService({
    environment: { HOME: fixture.home, PATH: "/usr/bin:/bin" },
    commandResolver: ({ environment }) => resolveQoderAcpCommand({
      environment,
      homeDirectory: fixture.home,
    }),
    resolveTask: async () => taskAuthority(),
  });
  t.after(() => service.dispose());

  assert.equal((await service.availability({ selection: QODER_SELECTION })).status, "not-installed");
  await symlink(fixture.bundle, fixture.launcher);
  assert.equal((await service.availability({ selection: QODER_SELECTION })).status, "ready");
});

test("Finder-sparse discovery covers npm prefixes and common Node managers", async (t) => {
  for (const [name, launcherDirectory, npmrcPrefix] of [
    ["npmrc-prefix", ["custom", "npm", "bin"], "~/custom/npm"],
    ["nvm", [".nvm", "versions", "node", "v22.4.1", "bin"], null],
    ["volta", [".volta", "bin"], null],
    ["fnm", [".local", "share", "fnm", "node-versions", "v22.4.1", "installation", "bin"], null],
    ["mise", [".local", "share", "mise", "installs", "node", "22.4.1", "bin"], null],
  ]) {
    await t.test(name, async (caseTest) => {
      const fixture = await createVerifiedNpmCommand(caseTest, {
        launcherRelativePath: null,
      });
      const binDirectory = path.join(fixture.home, ...launcherDirectory);
      await mkdir(binDirectory, { recursive: true });
      await symlink(fixture.bundle, path.join(binDirectory, "qodercli"));
      if (npmrcPrefix) {
        await writeFile(path.join(fixture.home, ".npmrc"), `prefix=${npmrcPrefix}\n`);
      }
      const resolved = await resolveQoderAcpCommand({
        environment: { HOME: fixture.home, PATH: "/usr/bin:/bin" },
        homeDirectory: fixture.home,
      });
      assert.equal(resolved.command, await realpath(fixture.bundle));
      assert.equal(resolved.source, "verified-npm-package");
    });
  }
});

test("local availability distinguishes unsupported or invalid installs from absence", async (t) => {
  await t.test("unsupported-version", async (caseTest) => {
    const fixture = await createVerifiedNpmCommand(caseTest, {
      manifestVersion: "1.1.26",
      reportedVersion: "1.1.26",
    });
    const service = new AgentBridgeService({
      environment: { HOME: fixture.home, PATH: "/usr/bin:/bin" },
      commandResolver: ({ environment }) => resolveQoderAcpCommand({
        environment,
        homeDirectory: fixture.home,
      }),
      resolveTask: async () => taskAuthority(),
    });
    caseTest.after(() => service.dispose());
    assert.deepEqual(await service.availability({ selection: QODER_SELECTION }), {
      ok: true,
      status: "unavailable",
      reason: "invalid-installation",
    });
  });

  await t.test("wrong-package-layout", async (caseTest) => {
    const command = await createFakeCommand(caseTest);
    const home = path.join(path.dirname(command), "home");
    const binDirectory = path.join(home, ".local", "bin");
    await mkdir(binDirectory, { recursive: true });
    await symlink(command, path.join(binDirectory, "qodercli"));
    const service = new AgentBridgeService({
      environment: { HOME: home, PATH: "/usr/bin:/bin" },
      commandResolver: ({ environment }) => resolveQoderAcpCommand({
        environment,
        homeDirectory: home,
      }),
      resolveTask: async () => taskAuthority(),
    });
    caseTest.after(() => service.dispose());
    assert.equal((await service.availability({ selection: QODER_SELECTION })).status, "unavailable");
  });
});

test("preflight failures state that no Request exists yet", async (t) => {
  for (const [stderr, code, expectedCopy] of [
    [
      "not logged in",
      "QODER_AUTH_REQUIRED",
      "Qoder CLI 尚未登录。",
    ],
    [
      "no available model capacity",
      "QODER_PREFLIGHT_FAILED",
      "Qoder CLI 预检没有完成。",
    ],
    [
      "You've reached your credit usage limit. Please upgrade your subscription plan.",
      "QODER_PREFLIGHT_FAILED",
      "Qoder CLI 预检没有完成。",
    ],
    [
      "unexpected preflight failure",
      "QODER_PREFLIGHT_FAILED",
      "Qoder CLI 预检没有完成。",
    ],
  ]) {
    await t.test(code, async (caseTest) => {
      const command = await createFailingCommand(caseTest, stderr);
      const service = createService(command);
      caseTest.after(() => service.dispose());
      await assert.rejects(
        preflight(service),
        (error) => (
          error?.code === code
          && error.message.startsWith(expectedCopy)
          && error.message.includes("尚未创建本轮 Request")
          && !error.message.includes("Request 已保留")
          && !error.message.includes("Request 与当前 HTML 均已保留")
        ),
      );
    });
  }
});

test("verified npm preflight normalizes version and empty-model failures before Request creation", async (t) => {
  for (const [name, fixtureOptions, expectedCode] of [
    ["invalid-version", { reportedVersion: "not-a-version" }, "QODER_VERSION_INVALID"],
    [
      "manifest-version-mismatch",
      { manifestVersion: "1.1.28", reportedVersion: "1.1.27" },
      "QODER_VERSION_MISMATCH",
    ],
    ["empty-model-list", { models: [] }, "QODER_MODEL_CATALOG_EMPTY"],
  ]) {
    await t.test(name, async (caseTest) => {
      const fixture = await createVerifiedNpmCommand(caseTest, fixtureOptions);
      const service = new AgentBridgeService({
        environment: { HOME: fixture.home, PATH: "/usr/bin:/bin" },
        commandResolver: ({ environment }) => resolveQoderAcpCommand({
          environment,
          homeDirectory: fixture.home,
        }),
        resolveTask: async () => taskAuthority(),
      });
      caseTest.after(() => service.dispose());
      await assert.rejects(
        preflight(service),
        (error) => (
          error?.code === expectedCode
          && error.message.includes("尚未创建本轮 Request")
          && !error.message.includes("Request 已保留")
        ),
      );
    });
  }
});

test("every locally generated preflight error uses the pre-Request copy contract", async (t) => {
  for (const code of [
    "QODER_AUTH_REQUIRED",
    "QODER_PREFLIGHT_TIMEOUT",
    "QODER_VERSION_INVALID",
    "QODER_VERSION_MISMATCH",
    "QODER_CAPACITY_UNAVAILABLE",
    "QODER_MODEL_CATALOG_EMPTY",
    "QODER_COMMAND_NOT_FOUND",
    "QODER_COMMAND_UNTRUSTED",
    "QODER_VERSION_UNSUPPORTED",
    "QODER_COMMAND_CHANGED",
  ]) {
    await t.test(code, async () => {
      const service = new AgentBridgeService({
        resolveTask: async () => taskAuthority(),
        commandResolver: async () => {
          throw new AgentBridgeError(code, "private preflight detail", { status: 503 });
        },
      });
      await assert.rejects(
        preflight(service),
        (error) => (
          error?.code === code
          && error.message.includes("尚未创建本轮 Request")
          && !error.message.includes("private preflight detail")
          && !error.message.includes("Request 已保留")
        ),
      );
      await service.dispose();
    });
  }
});

test("unconfirmed preflight cleanup fences later starts and Bridge shutdown", async (t) => {
  const command = await createFakeCommand(t);
  let preflightCalls = 0;
  const service = createService(command, {
    preflightRunner: async () => {
      preflightCalls += 1;
      throw new AgentBridgeError(
        "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED",
        "private process-group detail",
        { status: 503 },
      );
    },
  });

  await assert.rejects(
    preflight(service),
    (error) => (
      error?.code === "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED"
      && error.message.includes("尚未创建本轮 Request")
      && !error.message.includes("private process-group")
    ),
  );
  await assert.rejects(
    preflight(service),
    (error) => error?.code === "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED",
  );
  assert.equal(preflightCalls, 1);
  await assert.rejects(
    service.dispose(),
    (error) => error?.code === "AGENT_SHUTDOWN_UNCONFIRMED",
  );
});

test("Agent Bridge cancellation aborts the managed task before reporting stopped", async (t) => {
  const command = await createFakeCommand(t);
  const events = [];
  const service = createService(command, {
    runTask: ({ cancellationSignal, onEvent }) => new Promise((_resolve, reject) => {
      onEvent({ kind: "initialized", agentName: "stemmio-e2e-qoder", agentVersion: "1.1.27" });
      cancellationSignal.addEventListener("abort", () => {
        events.push("driver-aborted");
        const error = new Error("raw private driver detail");
        error.code = "ACP_CANCELLED";
        reject(error);
      }, { once: true });
    }),
  });
  t.after(() => service.dispose());
  const ticket = await preflight(service);
  await service.submit({
    ...IDENTITY,
    selection: QODER_SELECTION,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest,
  });

  const cancelled = await service.cancel(IDENTITY);
  events.push("cancel-returned");
  assert.equal(cancelled.stopped, true);
  assert.deepEqual(events, ["driver-aborted", "cancel-returned"]);
  assert.equal(cancelled.session.state, "cancelled");
  assert.equal(JSON.stringify(cancelled).includes("raw private"), false);
});

test("Agent Bridge cancellation never reports stopped after cleanup is unconfirmed", async (t) => {
  const command = await createFakeCommand(t);
  const root = await mkdtemp(path.join(os.tmpdir(), "stemmio-agent-cancel-unconfirmed-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const policy = {
    ...fakePolicy(),
    outputPath: path.join(root, "output", "candidate.html"),
    completionPath: path.join(root, "completion.json"),
  };
  let releaseCalls = 0;
  const service = createService(command, {
    policyLoader: async () => policy,
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ path: "memory-agent-lease", ownerToken }),
      release: async () => {
        releaseCalls += 1;
        return true;
      },
    },
    runTask: ({ cancellationSignal, onEvent }) => new Promise((_resolve, reject) => {
      onEvent({ kind: "initialized", agentName: "stemmio-e2e-qoder" });
      cancellationSignal.addEventListener("abort", () => {
        const error = new Error("private process-group cleanup detail");
        error.code = "ACP_PROCESS_CLEANUP_UNCONFIRMED";
        reject(error);
      }, { once: true });
    }),
  });
  const ticket = await preflight(service);
  await service.submit({
    ...IDENTITY,
    selection: QODER_SELECTION,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest,
  });
  await new Promise((resolve) => setImmediate(resolve));

  await assert.rejects(
    service.cancel(IDENTITY),
    (error) => (
      error?.code === "AGENT_CANCEL_UNCONFIRMED"
      && !error.message.includes("private process-group")
    ),
  );
  const failed = service.status(IDENTITY);
  assert.equal(failed.state, "cancelled");
  assert.equal(failed.errorCode, "AGENT_RESTART_RECOVERY_REQUIRED");
  assert.equal(releaseCalls, 0);
  await assert.rejects(
    service.dispose(),
    (error) => error?.code === "AGENT_SHUTDOWN_UNCONFIRMED",
  );
});

test("Agent Bridge cancellation timeout stays live and fails closed", async (t) => {
  const command = await createFakeCommand(t);
  let releaseCalls = 0;
  const service = createService(command, {
    cancelTimeoutMs: 25,
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ path: "memory-agent-lease", ownerToken }),
      release: async () => {
        releaseCalls += 1;
        return true;
      },
    },
    runTask: ({ onEvent }) => new Promise(() => {
      onEvent({ kind: "initialized", agentName: "stemmio-e2e-qoder" });
    }),
  });
  const ticket = await preflight(service);
  await service.submit({
    ...IDENTITY,
    selection: QODER_SELECTION,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest,
  });
  await new Promise((resolve) => setImmediate(resolve));

  await assert.rejects(
    service.cancel(IDENTITY),
    (error) => error?.code === "AGENT_CANCEL_UNCONFIRMED",
  );
  assert.equal(service.status(IDENTITY).state, "cancelling");
  assert.equal(releaseCalls, 0);
  await assert.rejects(
    service.dispose(),
    (error) => error?.code === "AGENT_SHUTDOWN_UNCONFIRMED",
  );
});

test("Workspace Bridge never durably cancels after Agent cancellation rejects", async () => {
  const events = [];
  const cleanupError = Object.assign(new Error("cleanup unconfirmed"), {
    code: "AGENT_CANCEL_UNCONFIRMED",
  });
  await assert.rejects(
    cancelDurableRequestAfterAgentCleanup({
      cancelAgent: async () => {
        events.push("agent-cancel");
        throw cleanupError;
      },
      cancelRequest: async () => {
        events.push("durable-cancel");
        return { status: "cancelled" };
      },
    }),
    cleanupError,
  );
  assert.deepEqual(events, ["agent-cancel"]);
});

test("Agent Bridge never invents a resumed Qoder session after restart", async (t) => {
  const command = await createFakeCommand(t);
  const service = createService(command, { runTask: async () => ({}) });
  t.after(() => service.dispose());
  assert.equal(service.status(IDENTITY), null);
  const interrupted = service.interrupted(IDENTITY, { selection: QODER_SELECTION });
  assert.equal(interrupted.state, "interrupted");
  assert.equal(interrupted.retryable, false);
  assert.equal(interrupted.errorCode, "AGENT_RESTART_RECOVERY_REQUIRED");
  assert.equal("sourcePath" in interrupted, false);
});

test("Agent Bridge persistent lease blocks a second service from racing the same Request", async (t) => {
  const command = await createFakeCommand(t);
  const root = await mkdtemp(path.join(os.tmpdir(), "stemmio-agent-lease-test-"));
  const requestPath = path.join(
    root,
    "project",
    ".stemmio",
    "requests",
    IDENTITY.requestId,
  );
  await mkdir(requestPath, { recursive: true });
  const environment = {
    ...process.env,
    STEMMIO_E2E: "1",
    STEMMIO_QODER_ACP_ALLOW_TEST_COMMAND: "1",
    STEMMIO_QODER_ACP_COMMAND: command,
  };
  const createLeasedService = (runTask) => {
    let service;
    service = new AgentBridgeService({
      environment,
      resolveTask: async () => {
        const authority = taskAuthority(IDENTITY, preflightTickets.get(service));
        authority.run.requestPath = requestPath;
        return authority;
      },
      policyLoader: async () => fakePolicy(),
      runTask,
    });
    return service;
  };
  const first = createLeasedService(({ cancellationSignal, onEvent }) => new Promise(
    (_resolve, reject) => {
      onEvent({ kind: "initialized", agentName: "stemmio-e2e-qoder" });
      cancellationSignal.addEventListener("abort", () => {
        const error = new Error("cancelled");
        error.code = "ACP_CANCELLED";
        reject(error);
      }, { once: true });
    },
  ));
  t.after(() => first.dispose());
  const firstTicket = await preflight(first);
  await first.submit({
    ...IDENTITY,
    selection: QODER_SELECTION,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: firstTicket.preflightId,
    configurationDigest: firstTicket.configuration.configurationDigest,
  });

  let secondRunCalls = 0;
  const second = createLeasedService(async () => {
    secondRunCalls += 1;
  });
  t.after(() => second.dispose());
  const secondTicket = await preflight(second);
  await assert.rejects(
    second.submit({
      ...IDENTITY,
      selection: QODER_SELECTION,
      trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      preflightId: secondTicket.preflightId,
      configurationDigest: secondTicket.configuration.configurationDigest,
    }),
    (error) => error?.code === "AGENT_RESTART_RECOVERY_REQUIRED",
  );
  assert.equal(secondRunCalls, 0);
  // Node test hooks run in registration order. Remove the lease root only
  // after both coordinators have confirmed their own lease disposition;
  // deleting it first must now (correctly) produce a release=false fence.
  t.after(() => rm(root, { recursive: true, force: true }));
});

test("Agent Bridge rejects a policy retry that would overwrite an unfinalized output", async (t) => {
  const command = await createFakeCommand(t);
  const service = createService(command, {
    policyLoader: async () => {
      const error = new Error("private output path");
      error.code = "ACP_OUTPUT_PREEXISTS";
      throw error;
    },
  });
  t.after(() => service.dispose());
  const ticket = await preflight(service);
  await assert.rejects(
    service.submit({
      ...IDENTITY,
      selection: QODER_SELECTION,
      trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      preflightId: ticket.preflightId,
      configurationDigest: ticket.configuration.configurationDigest,
    }),
    (error) => (
      error instanceof AgentBridgeError
      && error.code === "AGENT_RETRY_OUTPUT_PRESENT"
      && !error.message.includes("private output path")
    ),
  );
});

test("Agent Bridge uses only a structured Qoder credit-limit error after Request creation", async (t) => {
  const command = await createFakeCommand(t);
  const root = await mkdtemp(path.join(os.tmpdir(), "stemmio-agent-capacity-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = createService(command, {
    policyLoader: async () => ({
      ...fakePolicy(),
      outputPath: path.join(root, "output", "candidate.html"),
      completionPath: path.join(root, "completion.json"),
    }),
    runTask: async () => {
      const error = new Error("structured provider failure");
      error.code = "QODER_ACCOUNT_CAPACITY_UNAVAILABLE";
      throw error;
    },
  });
  t.after(() => service.dispose());
  const ticket = await preflight(service);
  await service.submit({
    ...IDENTITY,
    selection: QODER_SELECTION,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest,
  });

  const failed = await waitForState(service, "failed");
  assert.equal(failed.errorCode, "QODER_ACCOUNT_CAPACITY_UNAVAILABLE");
  assert.equal(failed.retryable, true);
  assert.equal(
    failed.errorMessage,
    "Qoder 账号当前没有可用模型容量。本轮 Request 已保留，可稍后重试或复制给其他 Agent。",
  );
  assert.equal(JSON.stringify(failed).includes("upgrade your subscription"), false);
});

test("Agent Bridge marks output written before failure as cancel-and-new only", async (t) => {
  const command = await createFakeCommand(t);
  const root = await mkdtemp(path.join(os.tmpdir(), "stemmio-agent-residue-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputPath = path.join(root, "attempt", "output", "candidate.html");
  await mkdir(path.dirname(outputPath), { recursive: true });
  const policy = {
    ...fakePolicy(),
    outputPath,
    completionPath: path.join(root, "attempt", "completion.json"),
  };
  const service = createService(command, {
    policyLoader: async () => policy,
    runTask: async () => {
      await writeFile(outputPath, "<!doctype html><html><body>partial</body></html>\n");
      const error = new Error("finalizer failed after output publication");
      error.code = "ACP_FINALIZER_EXIT_NONZERO";
      throw error;
    },
  });
  t.after(() => service.dispose());
  const ticket = await preflight(service);
  await service.submit({
    ...IDENTITY,
    selection: QODER_SELECTION,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest,
  });
  const failed = await waitForState(service, "failed");
  assert.equal(failed.state, "failed");
  assert.equal(failed.retryable, false);
  assert.equal(failed.errorCode, "AGENT_RETRY_OUTPUT_PRESENT");
  assert.equal(JSON.stringify(failed).includes(outputPath), false);
});

test("Agent Bridge keeps an uncertain cleanup fenced and blocks same-Request retry", async (t) => {
  const command = await createFakeCommand(t);
  const root = await mkdtemp(path.join(os.tmpdir(), "stemmio-agent-cleanup-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const policy = {
    ...fakePolicy(),
    outputPath: path.join(root, "attempt", "output", "candidate.html"),
    completionPath: path.join(root, "attempt", "completion.json"),
  };
  await mkdir(path.dirname(policy.outputPath), { recursive: true });
  let runCalls = 0;
  let releaseCalls = 0;
  const service = createService(command, {
    policyLoader: async () => policy,
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ path: "memory-agent-lease", ownerToken }),
      release: async () => {
        releaseCalls += 1;
        return true;
      },
    },
    runTask: async () => {
      runCalls += 1;
      await writeFile(policy.outputPath, "<!doctype html><html><body>partial</body></html>\n");
      const error = new Error("private process-group detail");
      error.code = "ACP_PROCESS_CLEANUP_UNCONFIRMED";
      throw error;
    },
  });
  t.after(() => service.dispose().catch(() => {}));
  const firstTicket = await preflight(service);
  await service.submit({
    ...IDENTITY,
    selection: QODER_SELECTION,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: firstTicket.preflightId,
    configurationDigest: firstTicket.configuration.configurationDigest,
  });
  const failed = await waitForState(service, "failed");
  assert.equal(failed.errorCode, "AGENT_RESTART_RECOVERY_REQUIRED");
  assert.equal(failed.retryable, false);
  assert.equal(JSON.stringify(failed).includes("private process-group"), false);
  assert.equal(releaseCalls, 0);

  const retryTicket = await preflight(service);
  await assert.rejects(
    service.submit({
      ...IDENTITY,
      selection: QODER_SELECTION,
      trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      preflightId: retryTicket.preflightId,
      configurationDigest: retryTicket.configuration.configurationDigest,
    }),
    (error) => error?.code === "AGENT_RESTART_RECOVERY_REQUIRED",
  );
  assert.equal(runCalls, 1);
  assert.equal(releaseCalls, 0);
  await assert.rejects(
    service.dispose(),
    (error) => error?.code === "AGENT_SHUTDOWN_UNCONFIRMED",
  );
});

test("Agent Bridge preserves a verified Candidate when ACP teardown is unconfirmed", async (t) => {
  const command = await createFakeCommand(t);
  const root = await mkdtemp(path.join(os.tmpdir(), "stemmio-agent-verified-cleanup-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const facts = [];
  const policy = {
    ...fakePolicy(),
    outputPath: path.join(root, "attempt", "output", "candidate.html"),
    completionPath: path.join(root, "attempt", "completion.json"),
  };
  const service = createService(command, {
    policyLoader: async () => policy,
    recordExecutionFact: async (_identity, event) => {
      facts.push(event);
    },
    runTask: async ({ onEvent }) => {
      onEvent({ kind: "visible-text", messageId: "result", text: "Candidate finalized successfully." });
      onEvent({ kind: "completion-verified", status: "completed" });
      const error = new Error("private process-group detail after completion");
      error.code = "ACP_PROCESS_CLEANUP_UNCONFIRMED";
      throw error;
    },
  });
  t.after(() => service.dispose().catch(() => {}));
  const ticket = await preflight(service);
  await service.submit({
    ...IDENTITY,
    selection: QODER_SELECTION,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest,
  });

  const completed = await waitForState(service, "completed");
  assert.equal(completed.state, "completed");
  assert.equal(completed.phase, "preparing-review");
  assert.equal(completed.errorCode, null);
  assert.equal(completed.errorMessage, null);
  assert.equal(completed.retryable, false);
  assert.equal(completed.safeToRetry, false);
  for (let index = 0; index < 50 && !facts.some((fact) => fact.kind === "execution-ended"); index += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(facts.some((fact) => fact.kind === "failed"), false);
  assert.deepEqual(
    facts.filter((fact) => ["public-summary", "execution-ended"].includes(fact.kind))
      .map((fact) => [fact.kind, fact.publicSummary || null]),
    [
      ["public-summary", "Candidate finalized successfully."],
      ["execution-ended", null],
    ],
  );
});

test("cleanup-unconfirmed fences survive terminal TTL and capacity pruning", async (t) => {
  const command = await createFakeCommand(t);
  const root = await mkdtemp(path.join(os.tmpdir(), "stemmio-agent-prune-fence-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let now = Date.parse("2026-08-11T00:00:00.000Z");
  const identities = [1, 2, 3].map((index) => ({
    ...IDENTITY,
    requestId: `req_cleanup_fence_${index}`,
  }));
  const service = createService(command, {
    clock: { now: () => now },
    terminalSessionTtlMs: 1,
    maxRetainedSessions: 1,
    resolveTask: async (identity, ticket) => taskAuthority(identity, ticket),
    policyLoader: async () => ({
      ...fakePolicy(),
      outputPath: path.join(root, "output", "candidate.html"),
      completionPath: path.join(root, "completion.json"),
    }),
    runTask: async () => {
      const error = new Error("private process-group cleanup detail");
      error.code = "ACP_PROCESS_CLEANUP_UNCONFIRMED";
      throw error;
    },
  });

  for (const identity of identities) {
    const ticket = await preflight(service);
    await service.submit({
      ...identity,
      selection: QODER_SELECTION,
      trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      preflightId: ticket.preflightId,
      configurationDigest: ticket.configuration.configurationDigest,
    });
    const failed = await waitForState(service, "failed", identity);
    assert.equal(failed.errorCode, "AGENT_RESTART_RECOVERY_REQUIRED");
  }

  now += 60_000;
  await preflight(service);
  for (const identity of identities) {
    assert.equal(
      service.status(identity)?.errorCode,
      "AGENT_RESTART_RECOVERY_REQUIRED",
    );
  }
  await assert.rejects(
    service.dispose(),
    (error) => error?.code === "AGENT_SHUTDOWN_UNCONFIRMED",
  );
});

test("Agent Bridge shutdown rejects when an owned Agent never confirms cleanup", async (t) => {
  const command = await createFakeCommand(t);
  let releaseCalls = 0;
  const service = createService(command, {
    cancelTimeoutMs: 25,
    leaseStore: {
      acquire: async ({ ownerToken }) => ({ path: "memory-agent-lease", ownerToken }),
      release: async () => {
        releaseCalls += 1;
        return true;
      },
    },
    runTask: ({ onEvent }) => new Promise(() => {
      onEvent({ kind: "initialized", agentName: "stemmio-e2e-qoder" });
    }),
  });
  const ticket = await preflight(service);
  await service.submit({
    ...IDENTITY,
    selection: QODER_SELECTION,
    trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
    preflightId: ticket.preflightId,
    configurationDigest: ticket.configuration.configurationDigest,
  });
  await new Promise((resolve) => setImmediate(resolve));

  await assert.rejects(
    service.dispose(),
    (error) => error?.code === "AGENT_SHUTDOWN_UNCONFIRMED",
  );
  assert.equal(releaseCalls, 0);
  assert.equal(service.status(IDENTITY).state, "running");
  await assert.rejects(
    service.dispose(),
    (error) => error?.code === "AGENT_SHUTDOWN_UNCONFIRMED",
  );
});

test("Workspace Bridge stays alive when Agent cleanup is not confirmed", async () => {
  const diagnostics = [];
  let closeCalls = 0;
  let exitCalls = 0;
  const accepted = await closeWorkspaceBridgeAfterAgentCleanup({
    agentBridgeService: {
      async dispose() {
        throw new Error("private process-group cleanup detail");
      },
    },
    closeServer() {
      closeCalls += 1;
    },
    exitProcess() {
      exitCalls += 1;
    },
    writeDiagnostic(line) {
      diagnostics.push(line);
    },
  });

  assert.equal(accepted, false);
  assert.equal(closeCalls, 0);
  assert.equal(exitCalls, 0);
  assert.equal(diagnostics.length, 1);
  assert.match(diagnostics[0], /AGENT_SHUTDOWN_UNCONFIRMED/u);
  assert.doesNotMatch(diagnostics[0], /private process-group/u);
});

test("Agent Bridge treats directories and special files at result paths as residue", async (t) => {
  const command = await createFakeCommand(t);
  for (const kind of ["directory", "socket"]) {
    await t.test(kind, async (caseTest) => {
      const root = await mkdtemp(path.join(
        kind === "socket" ? "/tmp" : os.tmpdir(),
        `stemmio-agent-${kind}-residue-`,
      ));
      caseTest.after(() => rm(root, { recursive: true, force: true }));
      const outputPath = path.join(root, "output");
      const completionPath = path.join(root, "completion");
      const policy = { ...fakePolicy(), outputPath, completionPath };
      let socket = null;
      const service = createService(command, {
        policyLoader: async () => policy,
        runTask: async () => {
          if (kind === "directory") {
            await mkdir(outputPath, { recursive: true });
          } else {
            await mkdir(path.dirname(completionPath), { recursive: true });
            socket = createServer();
            await new Promise((resolve, reject) => {
              socket.once("error", reject);
              socket.listen(completionPath, resolve);
            });
          }
          const error = new Error("result path is not a regular file");
          error.code = "ACP_RESULT_PATH_INVALID";
          throw error;
        },
      });
      caseTest.after(async () => {
        await service.dispose();
        if (socket?.listening) {
          await new Promise((resolve, reject) => socket.close((error) => (
            error ? reject(error) : resolve()
          )));
        }
      });
      const ticket = await preflight(service);
      await service.submit({
        ...IDENTITY,
        selection: QODER_SELECTION,
        trustPolicyAccepted: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
        preflightId: ticket.preflightId,
        configurationDigest: ticket.configuration.configurationDigest,
      });
      const failed = await waitForState(service, "failed");
      assert.equal(failed.errorCode, "AGENT_RETRY_OUTPUT_PRESENT");
      assert.equal(failed.retryable, false);
    });
  }
});

test("Agent Bridge never exposes command-discovery paths through preflight errors", async () => {
  const service = new AgentBridgeService({
    resolveTask: async () => taskAuthority(),
    commandResolver: async () => {
      throw new Error("ENOENT: /private/account/bin/qodercli");
    },
  });
  await assert.rejects(
    preflight(service),
    (error) => (
      error instanceof AgentBridgeError
      && error.code === "QODER_COMMAND_UNTRUSTED"
      && !error.message.includes("/private/account")
    ),
  );
  await service.dispose();
});

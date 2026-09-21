import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  link,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as acp from "@agentclientprotocol/sdk";

import {
  acpDriverProfile,
  captureQoderAcpReviewBoundary,
  createRestrictedQoderAcpHost,
  loadQoderAcpTaskPolicy,
  prepareVerifiedQoderJavaScriptExecution,
  runAcpTask,
  runQoderAcpTask,
  runVerifiedQoderJavaScript,
} from "../bridge/qoder-acp-client.mjs";
import {
  DEFAULT_ACP_TURN_TIMEOUT_MS,
  runAcpTask as runGenericAcpTask,
} from "../bridge/agent/runtimes/acp-protocol.mjs";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import { compileTaskSpec } from "../shared/task-spec.mjs";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";
import { inspectSourceElementIdentity } from "../bridge/project-file-repository/working-copy.mjs";

const IDENTITIES = Object.freeze({
  requestId: "req_aaaaaaaaaaaaaaaa",
  attemptId: "attempt_001",
});
const READ_FILE_COUNT = 6;
const productRoot = fileURLToPath(new URL("../", import.meta.url));
const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const acpSdkModuleUrl = pathToFileURL(path.join(
  productRoot,
  "node_modules",
  "@agentclientprotocol",
  "sdk",
  "dist",
  "acp.js",
)).href;

function createVirtualTimer() {
  let currentTime = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    clock: { now: () => currentTime },
    scheduler: {
      setTimeout(callback, delay) {
        const id = nextId;
        nextId += 1;
        pending.set(id, { callback, dueAt: currentTime + delay });
        return id;
      },
      clearTimeout(id) {
        pending.delete(id);
      },
    },
    advance(milliseconds) {
      currentTime += milliseconds;
      const due = [...pending.entries()]
        .filter(([, task]) => task.dueAt <= currentTime)
        .sort((left, right) => left[1].dueAt - right[1].dueAt);
      for (const [id, task] of due) {
        if (!pending.delete(id)) continue;
        task.callback();
      }
    },
    now: () => currentTime,
  };
}

async function createFixture(t) {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "stemmio-qoder-acp-test-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const sources = path.join(root, "sources");
  const projects = path.join(root, "projects");
  await mkdir(sources, { recursive: true });
  const sourceHtml = "<!doctype html><html><head><title>Before</title></head><body><h1>Before</h1></body></html>\n";
  const sourcePath = path.join(sources, "synthetic.html");
  await writeFile(sourcePath, sourceHtml, "utf8");
  const repository = new ProjectFileRepository({ projectsRoot: projects });
  const imported = await repository.importExternal({
    sourcePath,
    expectedSourceSha256: sha256(Buffer.from(sourceHtml, "utf8")),
  });
  const { target } = imported;
  const managedSourceHtml = await readFile(target.exactSourcePath, "utf8");
  assert.equal(inspectSourceElementIdentity(managedSourceHtml).complete, true);
  const promptText = "Follow the Stemmio task contract.\n";
  const comments = [{
    commentId: "comment_synthetic_acp",
    text: "Synthetic ACP test",
    target: { targetId: "target_synthetic_acp" },
    attachments: [],
  }];
  const targets = [{ targetId: "target_synthetic_acp" }];
  const request = await repository.prepareRequest({
    target,
    ...IDENTITIES,
    expectedSourceSha256: target.sourceSha256,
    request: {
      freezeCutoffRevision: 0,
      summary: "Synthetic ACP test",
      comments,
      changeEvents: [],
      targets,
      taskSpec: compileTaskSpec({ comments, targets }),
    },
    prompt: promptText,
  });
  const requestPath = await realpath(path.join(
    target.projectRootPath,
    ".stemmio",
    "requests",
    IDENTITIES.requestId,
  ));
  const outputPath = path.join(
    requestPath,
    "attempts",
    IDENTITIES.attemptId,
    "output",
    "candidate.html",
  );
  const completionPath = path.join(
    requestPath,
    "attempts",
    IDENTITIES.attemptId,
    "completion.json",
  );
  const manifestPath = path.join(requestPath, "input-manifest.json");
  const options = {
    requestPath,
    promptPath: path.join(requestPath, "PROMPT.md"),
    outputPath,
    completionPath,
  };
  const policy = await loadQoderAcpTaskPolicy(options);
  return {
    root,
    repository,
    target,
    sourcePath,
    sourceHtml,
    managedSourceHtml,
    requestPath,
    manifestPath,
    outputPath,
    completionPath,
    finalizer: policy.finalizer,
    promptText,
    request,
    options,
    policy,
  };
}

function identityPreservingCandidate(fixture, label) {
  return fixture.managedSourceHtml.replaceAll("Before", label);
}

test("Qoder ACP policy freezes identities, hashes, and real files", async (t) => {
  const fixture = await createFixture(t);
  assert.equal(fixture.policy.requestRoot, fixture.requestPath);
  assert.equal(fixture.policy.readableFiles.length, READ_FILE_COUNT + 1);

  await writeFile(fixture.options.promptPath, "drifted\n", "utf8");
  await assert.rejects(
    loadQoderAcpTaskPolicy(fixture.options),
    (error) => error?.code === "ACP_FROZEN_INPUT_DRIFT",
  );
});

test("Qoder ACP policy canonicalizes macOS /var aliases without weakening path checks", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("macOS path alias coverage");
    return;
  }
  const fixture = await createFixture(t);
  if (!fixture.requestPath.startsWith("/private/var/")) {
    t.skip("temporary root is not using the /private/var alias");
    return;
  }
  const alias = (value) => value.replace(/^\/private\/var\//u, "/var/");
  const policy = await loadQoderAcpTaskPolicy({
    requestPath: alias(fixture.options.requestPath),
    promptPath: alias(fixture.options.promptPath),
    outputPath: alias(fixture.options.outputPath),
    completionPath: alias(fixture.options.completionPath),
  });
  assert.equal(policy.requestRoot, fixture.requestPath);
  assert.equal(policy.promptPath, fixture.options.promptPath);
  assert.equal(policy.outputPath, fixture.options.outputPath);
});

test("Qoder ACP policy rejects symlinked frozen input", async (t) => {
  const fixture = await createFixture(t);
  const rulesPath = path.join(fixture.requestPath, "input", "AI_RULES.md");
  const targetPath = path.join(fixture.requestPath, "input", "rules-target.md");
  await writeFile(targetPath, "Only modify the frozen Candidate.\n", "utf8");
  await rm(rulesPath);
  await symlink(targetPath, rulesPath);

  await assert.rejects(
    loadQoderAcpTaskPolicy(fixture.options),
    (error) => error?.code === "ACP_UNSAFE_FILE",
  );
});

test("Qoder ACP policy rejects a symlinked frozen-input ancestor", async (t) => {
  const fixture = await createFixture(t);
  const annotationsRoot = path.join(fixture.requestPath, "input", "annotations");
  const movedRoot = path.join(fixture.requestPath, "input", "annotations-real");
  await rename(annotationsRoot, movedRoot);
  await symlink(movedRoot, annotationsRoot, "dir");

  await assert.rejects(
    loadQoderAcpTaskPolicy(fixture.options),
    (error) => error?.code === "ACP_UNSAFE_ANCESTOR",
  );
});

test("Qoder ACP policy derives authority and rejects caller-injected policy fields", async (t) => {
  const fixture = await createFixture(t);
  await assert.rejects(
    loadQoderAcpTaskPolicy({
      ...fixture.options,
      inputManifestSha256: "sha256:" + "0".repeat(64),
    }),
    (error) => error?.code === "ACP_POLICY_OPTIONS_INVALID",
  );
  await assert.rejects(
    loadQoderAcpTaskPolicy({
      ...fixture.options,
      outputPath: path.join(
        fixture.requestPath,
        "attempts",
        IDENTITIES.attemptId,
        "output",
        "other.html",
      ),
    }),
    (error) => error?.code === "ACP_OUTPUT_ATTEMPT_MISMATCH",
  );
  await assert.rejects(
    loadQoderAcpTaskPolicy({
      ...fixture.options,
      finalizer: fixture.finalizer,
    }),
    (error) => error?.code === "ACP_POLICY_OPTIONS_INVALID",
  );

  const runtimePath = path.join(
    path.dirname(path.dirname(fixture.requestPath)),
    "runtime-state.json",
  );
  const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
  runtime.activeRequest.inputManifestSha256 = "sha256:" + "0".repeat(64);
  await writeFile(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadQoderAcpTaskPolicy(fixture.options),
    (error) => error?.code === "ACP_RUNTIME_AUTHORITY_MISMATCH",
  );

  const forgedRequestFixture = await createFixture(t);
  const requestRecordPath = path.join(forgedRequestFixture.requestPath, "request.json");
  const requestRecord = JSON.parse(await readFile(requestRecordPath, "utf8"));
  requestRecord.outputRelativePath = `requests/${IDENTITIES.requestId}/attempts/${IDENTITIES.attemptId}/output/other.html`;
  await writeFile(requestRecordPath, `${JSON.stringify(requestRecord, null, 2)}\n`, "utf8");
  await assert.rejects(
    loadQoderAcpTaskPolicy(forgedRequestFixture.options),
    (error) => error?.code === "ACP_REQUEST_AUTHORITY_MISMATCH",
  );

  const manifestDriftFixture = await createFixture(t);
  const manifestText = await readFile(manifestDriftFixture.manifestPath, "utf8");
  await writeFile(manifestDriftFixture.manifestPath, `${manifestText}\n`, "utf8");
  await assert.rejects(
    loadQoderAcpTaskPolicy(manifestDriftFixture.options),
    (error) => error?.code === "ACP_INPUT_MANIFEST_HASH_MISMATCH",
  );
});

test("restricted Qoder ACP host exposes only frozen reads, Candidate write, and finalizer", async (t) => {
  const fixture = await createFixture(t);
  const events = [];
  const host = createRestrictedQoderAcpHost(fixture.policy, {
    onEvent: (event) => events.push(event),
  });
  t.after(() => host.dispose());
  const sessionId = "session_synthetic";
  host.bindSessionId(sessionId);

  const prompt = await host.readTextFile({
    sessionId,
    path: fixture.options.promptPath,
    line: 1,
    limit: 1,
  });
  assert.equal(prompt.content, fixture.promptText);
  await assert.rejects(
    host.readTextFile({
      sessionId,
      path: fixture.options.promptPath,
      line: 0,
    }),
    (error) => error?.code === "ACP_READ_RANGE_INVALID",
  );
  await assert.rejects(
    host.readTextFile({ sessionId, path: path.join(fixture.requestPath, "secret.txt") }),
    (error) => error?.code === "ACP_READ_NOT_AUTHORIZED",
  );
  await assert.rejects(
    host.readTextFile({ sessionId: "wrong", path: fixture.options.promptPath }),
    (error) => error?.code === "ACP_SESSION_ID_MISMATCH",
  );

  const candidate = identityPreservingCandidate(fixture, "ACP Candidate");
  await link(fixture.options.promptPath, fixture.outputPath);
  await assert.rejects(
    host.writeTextFile({ sessionId, path: fixture.outputPath, content: candidate }),
    (error) => error?.code === "ACP_UNSAFE_OUTPUT_FILE",
  );
  assert.equal(await readFile(fixture.options.promptPath, "utf8"), fixture.promptText);
  await rm(fixture.outputPath);
  await host.writeTextFile({
    sessionId,
    path: fixture.outputPath,
    content: candidate,
  });
  assert.equal(await readFile(fixture.outputPath, "utf8"), candidate);
  await assert.rejects(
    host.writeTextFile({
      sessionId,
      path: path.join(fixture.requestPath, "current.html"),
      content: candidate,
    }),
    (error) => error?.code === "ACP_WRITE_NOT_AUTHORIZED",
  );
  await assert.rejects(
    host.createTerminal({ sessionId, command: process.execPath, args: ["--version"] }),
    (error) => error?.code === "ACP_TERMINAL_NOT_AUTHORIZED",
  );
  await assert.rejects(
    host.createTerminal({
      sessionId,
      command: fixture.finalizer.command,
      args: fixture.finalizer.args,
    }),
    (error) => error?.code === "ACP_TERMINAL_NOT_AUTHORIZED",
  );
  await assert.rejects(
    host.createTerminal({
      sessionId,
      command: fixture.finalizer.command,
      args: fixture.finalizer.args,
      cwd: fixture.finalizer.cwd,
    }),
    (error) => error?.code === "ACP_TERMINAL_NOT_AUTHORIZED",
  );

  const permission = await host.requestPermission({
    sessionId,
    toolCall: { kind: "execute" },
    options: [
      { optionId: "always", kind: "allow_always", name: "Always" },
      { optionId: "once", kind: "allow_once", name: "Once" },
    ],
  });
  assert.deepEqual(permission, {
    outcome: { outcome: "selected", optionId: "once" },
  });
  assert.deepEqual(await host.requestPermission({
    sessionId,
    toolCall: { kind: "execute" },
    options: [{ optionId: "always", kind: "allow_always", name: "Always" }],
  }), { outcome: { outcome: "cancelled" } });

  const created = await host.createTerminal({
    sessionId,
    command: fixture.finalizer.command,
    args: fixture.finalizer.args,
    cwd: fixture.finalizer.cwd,
    env: Object.entries(fixture.finalizer.env).map(([name, value]) => ({ name, value })),
    outputByteLimit: 1024,
  });
  const exitStatus = await host.waitForTerminalExit({ sessionId, terminalId: created.terminalId });
  const terminalOutput = await host.terminalOutput({
    sessionId,
    terminalId: created.terminalId,
  });
  assert.deepEqual(exitStatus, {
    exitCode: 0,
    signal: null,
  }, terminalOutput.output);
  const completion = JSON.parse(await readFile(fixture.completionPath, "utf8"));
  assert.equal(completion.requestId, IDENTITIES.requestId);
  assert.equal(completion.outputSha256, sha256(Buffer.from(candidate, "utf8")));
  assert.deepEqual(terminalOutput.exitStatus, { exitCode: 0, signal: null });
  await host.releaseTerminal({ sessionId, terminalId: created.terminalId });
  const verifiedCompletion = await host.assertTurnCompleted();
  assert.equal(verifiedCompletion.outputSha256, completion.outputSha256);
  await assert.rejects(
    host.writeTextFile({ sessionId, path: fixture.outputPath, content: candidate }),
    (error) => error?.code === "ACP_HOST_FINALIZED",
  );
  assert.ok(events.some((event) => event.kind === "file-read"));
  assert.ok(events.some((event) => event.kind === "file-written"));
  assert.ok(events.some((event) => event.kind === "terminal-exited"));
});

test("finalizer spawn failure retains one diagnostic output and forbids replay", async (t) => {
  const fixture = await createFixture(t);
  const host = createRestrictedQoderAcpHost(fixture.policy, {
    spawnProcess: () => {
      const error = new Error("synthetic finalizer spawn failure");
      error.code = "ENOENT";
      throw error;
    },
  });
  t.after(() => host.dispose());
  const sessionId = "session_finalizer_spawn_failure";
  host.bindSessionId(sessionId);
  const candidate = identityPreservingCandidate(fixture, "ACP Candidate");
  await host.writeTextFile({
    sessionId,
    path: fixture.outputPath,
    content: candidate,
  });
  const terminalRequest = {
    sessionId,
    command: fixture.finalizer.command,
    args: fixture.finalizer.args,
    cwd: fixture.finalizer.cwd,
    env: Object.entries(fixture.finalizer.env).map(([name, value]) => ({ name, value })),
  };
  await assert.rejects(
    host.createTerminal(terminalRequest),
    /synthetic finalizer spawn failure/u,
  );
  assert.equal(await readFile(fixture.outputPath, "utf8"), candidate);
  await assert.rejects(readFile(fixture.completionPath), (error) => error?.code === "ENOENT");
  await assert.rejects(
    host.createTerminal(terminalRequest),
    (error) => error?.code === "ACP_FINALIZER_ALREADY_STARTED",
  );
});

test("restricted Qoder ACP host rejects cancelled and late mutating requests", async (t) => {
  const fixture = await createFixture(t);
  const host = createRestrictedQoderAcpHost(fixture.policy);
  t.after(() => host.dispose());
  const sessionId = "session_cancel_boundary";
  host.bindSessionId(sessionId);
  const candidate = identityPreservingCandidate(fixture, "ACP Candidate");
  await host.writeTextFile({
    sessionId,
    path: fixture.outputPath,
    content: candidate,
  });

  const requestCancellation = new AbortController();
  requestCancellation.abort();
  await assert.rejects(
    host.readTextFile({ sessionId, path: fixture.options.promptPath }, requestCancellation.signal),
    (error) => error?.code === "ACP_REQUEST_CANCELLED",
  );

  await host.cancel();
  assert.deepEqual(await host.requestPermission({
    sessionId,
    toolCall: { kind: "edit" },
    options: [{ optionId: "once", kind: "allow_once", name: "Once" }],
  }), { outcome: { outcome: "cancelled" } });
  await assert.rejects(
    host.writeTextFile({
      sessionId,
      path: fixture.outputPath,
      content: "<!doctype html><html><body><h1>Late write</h1></body></html>\n",
    }),
    (error) => error?.code === "ACP_HOST_CANCELLING",
  );
  await assert.rejects(
    host.createTerminal({
      sessionId,
      command: fixture.finalizer.command,
      args: fixture.finalizer.args,
      cwd: fixture.finalizer.cwd,
      env: [],
    }),
    (error) => error?.code === "ACP_HOST_CANCELLING",
  );
  assert.equal(await readFile(fixture.outputPath, "utf8"), candidate);
});

test("restricted Qoder ACP host rechecks durable runtime authority before every mutation", async (t) => {
  const fixture = await createFixture(t);
  const host = createRestrictedQoderAcpHost(fixture.policy);
  host.bindSessionId("session_authority_drift");
  const runtimePath = path.join(
    fixture.target.projectRootPath,
    ".stemmio",
    "runtime-state.json",
  );
  const runtime = JSON.parse(await readFile(runtimePath, "utf8"));
  runtime.activeRequest = null;
  runtime.activeCandidateId = null;
  await writeFile(runtimePath, `${JSON.stringify(runtime, null, 2)}\n`, "utf8");

  await assert.rejects(
    host.writeTextFile({
      sessionId: "session_authority_drift",
      path: fixture.outputPath,
      content: "<!doctype html><html><body><h1>Late</h1></body></html>\n",
    }),
    (error) => error?.code === "ACP_RUNTIME_AUTHORITY_DRIFT",
  );
  await host.dispose();
});

test("Qoder ACP mutation lock closes cancel and finalizer overlap races", async (t) => {
  const cancelledFixture = await createFixture(t);
  let announceCancelledRename;
  let releaseCancelledRename;
  const cancelledRenameStarted = new Promise((resolve) => {
    announceCancelledRename = resolve;
  });
  const cancelledRenameRelease = new Promise((resolve) => {
    releaseCancelledRename = resolve;
  });
  const cancelledHost = createRestrictedQoderAcpHost(cancelledFixture.policy, {
    renameOutput: async (...args) => {
      announceCancelledRename();
      await cancelledRenameRelease;
      return rename(...args);
    },
  });
  t.after(() => cancelledHost.dispose());
  const cancelledSessionId = "session_cancel_during_rename";
  cancelledHost.bindSessionId(cancelledSessionId);
  const candidate = identityPreservingCandidate(cancelledFixture, "ACP Candidate");
  const cancelledWrite = cancelledHost.writeTextFile({
    sessionId: cancelledSessionId,
    path: cancelledFixture.outputPath,
    content: candidate,
  });
  void cancelledWrite.catch(() => {});
  await cancelledRenameStarted;
  const cancellation = cancelledHost.cancel();
  releaseCancelledRename();
  await assert.rejects(
    cancelledWrite,
    (error) => error?.code === "ACP_HOST_CANCELLING",
  );
  await cancellation;
  await assert.rejects(
    readFile(cancelledFixture.outputPath),
    (error) => error?.code === "ENOENT",
  );
  assert.deepEqual(await readdir(path.dirname(cancelledFixture.outputPath)), []);

  const serializedFixture = await createFixture(t);
  let announceSerializedRename;
  let releaseSerializedRename;
  const serializedRenameStarted = new Promise((resolve) => {
    announceSerializedRename = resolve;
  });
  const serializedRenameRelease = new Promise((resolve) => {
    releaseSerializedRename = resolve;
  });
  const events = [];
  const serializedHost = createRestrictedQoderAcpHost(serializedFixture.policy, {
    renameOutput: async (...args) => {
      announceSerializedRename();
      await serializedRenameRelease;
      return rename(...args);
    },
    onEvent: (event) => events.push(event.kind),
  });
  t.after(() => serializedHost.dispose());
  const serializedSessionId = "session_write_before_finalizer";
  serializedHost.bindSessionId(serializedSessionId);
  const serializedWrite = serializedHost.writeTextFile({
    sessionId: serializedSessionId,
    path: serializedFixture.outputPath,
    content: identityPreservingCandidate(serializedFixture, "ACP Candidate"),
  });
  await serializedRenameStarted;
  let terminalSettled = false;
  const terminalCreation = serializedHost.createTerminal({
    sessionId: serializedSessionId,
    command: serializedFixture.finalizer.command,
    args: serializedFixture.finalizer.args,
    cwd: serializedFixture.finalizer.cwd,
    env: [],
    outputByteLimit: 1024,
  }).finally(() => {
    terminalSettled = true;
  });
  void terminalCreation.catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(terminalSettled, false);
  releaseSerializedRename();
  await serializedWrite;
  const created = await terminalCreation;
  const exit = await serializedHost.waitForTerminalExit({
    sessionId: serializedSessionId,
    terminalId: created.terminalId,
  });
  assert.deepEqual(exit, { exitCode: 0, signal: null });
  await serializedHost.releaseTerminal({
    sessionId: serializedSessionId,
    terminalId: created.terminalId,
  });
  await serializedHost.assertTurnCompleted();
  assert.ok(events.indexOf("file-written") < events.indexOf("terminal-created"));
});

function createSyntheticAgent(fixture, observed) {
  const sessionId = "session_agent_bridge";
  return acp
    .agent({ name: "stemmio-synthetic-agent" })
    .onRequest(acp.methods.agent.initialize, ({ params }) => {
      observed.initialize = params;
      return {
        protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: { loadSession: false },
        authMethods: [],
        agentInfo: {
          name: observed.agentName || "stemmio-synthetic-agent",
          title: "Stemmio Synthetic Agent",
          version: "1.0.0",
        },
      };
    })
    .onRequest(acp.methods.agent.session.new, ({ params }) => {
      observed.newSession = params;
      return { sessionId };
    })
    .onRequest(acp.methods.agent.session.prompt, async ({ params, client }) => {
      observed.prompt = params;
      observed.promptCount = (observed.promptCount || 0) + 1;
      if (observed.rejectIdentity && (observed.promptCount === 1 || observed.alwaysRejectIdentity)) {
        const bad = identityPreservingCandidate(fixture, "ACP Candidate").replace(/sm1_[a-f0-9]+/u, `sm1_${"f".repeat(12)}4fff8${"f".repeat(15)}`);
        await assert.rejects(client.request(acp.methods.client.fs.writeTextFile, {
          sessionId, path: fixture.outputPath, content: bad,
        }));
        await assert.rejects(readFile(fixture.outputPath), { code: "ENOENT" });
        await assert.rejects(readFile(fixture.completionPath), { code: "ENOENT" });
        return { stopReason: "end_turn" };
      }
      for (const text of observed.visibleTextChunks || []) {
        await client.notify(acp.methods.client.session.update, {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text },
            ...(observed.visibleTextMessageId
              ? { messageId: observed.visibleTextMessageId }
              : {}),
          },
        });
      }
      for (let index = 0; index < (observed.updateCount || 1); index += 1) {
        await client.notify(acp.methods.client.session.update, {
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: `tool_synthetic_${index}`,
            title: "Build Candidate",
            kind: "edit",
            status: "in_progress",
            locations: [{ path: fixture.outputPath }],
          },
        });
      }
      const permission = await client.request(
        acp.methods.client.session.requestPermission,
        {
          sessionId,
          toolCall: {
            toolCallId: "tool_synthetic",
            title: "Build Candidate",
            kind: "edit",
            status: "pending",
          },
          options: [
            { optionId: "allow", kind: "allow_once", name: "Allow once" },
            { optionId: "reject", kind: "reject_once", name: "Reject" },
          ],
        },
      );
      observed.permission = permission;
      observed.manifest = await client.request(acp.methods.client.fs.readTextFile, {
        sessionId,
        path: fixture.manifestPath,
      });
      observed.promptFile = await client.request(acp.methods.client.fs.readTextFile, {
        sessionId,
        path: fixture.options.promptPath,
      });
      const candidate = identityPreservingCandidate(fixture, "ACP Candidate");
      await client.request(acp.methods.client.fs.writeTextFile, {
        sessionId,
        path: fixture.outputPath,
        content: candidate,
      });
      const created = await client.request(acp.methods.client.terminal.create, {
        sessionId,
        command: fixture.finalizer.command,
        args: fixture.finalizer.args,
        cwd: fixture.finalizer.cwd,
        env: Object.entries(fixture.finalizer.env).map(([name, value]) => ({ name, value })),
        outputByteLimit: 1024,
      });
      observed.exit = await client.request(acp.methods.client.terminal.waitForExit, {
        sessionId,
        terminalId: created.terminalId,
      });
      observed.output = await client.request(acp.methods.client.terminal.output, {
        sessionId,
        terminalId: created.terminalId,
      });
      await client.request(acp.methods.client.terminal.release, {
        sessionId,
        terminalId: created.terminalId,
      });
      return { stopReason: "end_turn" };
    });
}

async function createStdioAgentScript(fixture) {
  const scriptPath = path.join(fixture.root, "synthetic-stdio-agent.mjs");
  const source = `#!/usr/bin/env node
import { Readable, Writable } from "node:stream";
import * as acp from ${JSON.stringify(acpSdkModuleUrl)};

const config = JSON.parse(process.argv[2]);
const sessionId = "session_stdio_agent";
const app = acp.agent({ name: "stemmio-stdio-agent" })
  .onRequest(acp.methods.agent.initialize, () => ({
    protocolVersion: acp.PROTOCOL_VERSION,
    agentCapabilities: { loadSession: false },
    authMethods: [],
    agentInfo: { name: "stemmio-stdio-agent", version: "1.0.0" },
  }))
  .onRequest(acp.methods.agent.session.new, ({ params }) => {
    if (params.cwd !== config.requestPath || params.mcpServers.length !== 0) {
      throw new Error("unexpected session scope");
    }
    return { sessionId };
  })
  .onRequest(acp.methods.agent.session.prompt, async ({ client }) => {
    if (config.hang) return new Promise(() => {});
    await client.request(acp.methods.client.fs.readTextFile, {
      sessionId,
      path: config.manifestPath,
    });
    await client.request(acp.methods.client.fs.writeTextFile, {
      sessionId,
      path: config.outputPath,
      content: config.candidate,
    });
    const terminal = await client.request(acp.methods.client.terminal.create, {
      sessionId,
      command: config.finalizer.command,
      args: config.finalizer.args,
      cwd: config.finalizer.cwd,
      env: [],
      outputByteLimit: 4096,
    });
    const status = await client.request(acp.methods.client.terminal.waitForExit, {
      sessionId,
      terminalId: terminal.terminalId,
    });
    if (status.exitCode !== 0 || status.signal) throw new Error("finalizer failed");
    await client.request(acp.methods.client.terminal.release, {
      sessionId,
      terminalId: terminal.terminalId,
    });
    if (config.exitAfterStop) setTimeout(() => process.exit(0), 0);
    return { stopReason: "end_turn" };
  });

app.connect(acp.ndJsonStream(
  Writable.toWeb(process.stdout),
  Readable.toWeb(process.stdin),
));
`;
  await writeFile(scriptPath, source, { encoding: "utf8", mode: 0o700 });
  await chmod(scriptPath, 0o700);
  return scriptPath;
}

async function createRawStdoutScript(fixture, name, body) {
  const scriptPath = path.join(fixture.root, `${name}.mjs`);
  await writeFile(scriptPath, `${body}\nsetInterval(() => {}, 1_000);\n`, "utf8");
  return scriptPath;
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processExists(pid);
}

test("ACP ClientApp completes a synthetic Stemmio Candidate turn", async (t) => {
  const fixture = await createFixture(t);
  const reviewBoundaryBefore = await captureQoderAcpReviewBoundary({
    repository: fixture.repository,
    target: fixture.target,
    projectRoot: fixture.target.projectRootPath,
  });
  const observed = {};
  const events = [];
  const result = await runAcpTask({
    connection: createSyntheticAgent(fixture, observed),
    policy: fixture.policy,
    prompt: "Read PROMPT.md and complete the frozen task.",
    onEvent: (event) => events.push(event),
    startupTimeoutMs: 1_000,
    turnTimeoutMs: 2_000,
  });

  assert.equal(result.stopReason, "end_turn");
  assert.equal(result.initialized.agentInfo.name, "stemmio-synthetic-agent");
  assert.equal(observed.newSession.cwd, fixture.requestPath);
  assert.deepEqual(observed.newSession.mcpServers, []);
  assert.equal(observed.newSession.additionalDirectories, undefined);
  assert.deepEqual(observed.permission, {
    outcome: { outcome: "selected", optionId: "allow" },
  });
  assert.match(observed.manifest.content, /"frozen": true/u);
  assert.equal(observed.promptFile.content, fixture.promptText);
  assert.deepEqual(observed.exit, { exitCode: 0, signal: null });
  const status = await fixture.repository.requestStatus({
    target: fixture.target,
    ...IDENTITIES,
  });
  assert.equal(status.status, "candidate-ready");
  assert.equal(status.candidate.outputSha256, result.completion.outputSha256);
  assert.equal(await readFile(fixture.sourcePath, "utf8"), fixture.sourceHtml);
  assert.equal(
    await readFile(fixture.target.exactSourcePath, "utf8"),
    fixture.managedSourceHtml,
  );
  const reviewBoundaryAfter = await captureQoderAcpReviewBoundary({
    repository: fixture.repository,
    target: fixture.target,
    projectRoot: fixture.target.projectRootPath,
  });
  assert.deepEqual(reviewBoundaryAfter, reviewBoundaryBefore);
  assert.equal(result.updates[0].type, "tool_call");
  assert.ok(events.some((event) => event.kind === "turn-stopped"));
  // An execution turn passes no Agent prose: its payload is the Candidate file.
  assert.equal(Object.hasOwn(result, "visibleText"), false);
  assert.equal(result.visibleTextTruncated, false);
  assert.equal(events.some((event) => event.kind === "visible-text"), false);
});

test("ACP session progress retains and publishes only a bounded update prefix", async (t) => {
  const fixture = await createFixture(t);
  const observed = { updateCount: 520 };
  const events = [];
  const result = await runAcpTask({
    connection: createSyntheticAgent(fixture, observed),
    policy: fixture.policy,
    prompt: "Complete the bounded progress fixture.",
    onEvent: (event) => events.push(event),
    startupTimeoutMs: 1_000,
    turnTimeoutMs: 4_000,
  });

  assert.equal(result.updates.length, 512);
  assert.equal(result.droppedUpdateCount, 8);
  assert.equal(events.filter((event) => event.kind === "session-update").length, 512);
  assert.equal(events.filter((event) => event.kind === "session-updates-truncated").length, 1);
});

test("ACP execution projects public Agent messages and marks a bounded text tail", async (t) => {
  const fixture = await createFixture(t);
  const observed = {
    visibleTextMessageId: "qoder_message_001",
    visibleTextChunks: [
      "先读取 capacity、quota 和 model unavailable 说明。\u0000",
      "再写入 Candidate。",
      "x".repeat((64 * 1024) + 32),
    ],
  };
  const events = [];
  const result = await runAcpTask({
    connection: createSyntheticAgent(fixture, observed),
    policy: fixture.policy,
    prompt: "Complete the visible-text fixture.",
    onEvent: (event) => events.push(event),
    startupTimeoutMs: 1_000,
    turnTimeoutMs: 4_000,
  });

  const publicNarration = events
    .filter((event) => event.kind === "visible-text")
    .map((event) => event.text)
    .join("");
  assert.equal(publicNarration.startsWith("先读取 capacity、quota 和 model unavailable 说明。再写入 Candidate。"), true);
  assert.equal(publicNarration.includes("\u0000"), false);
  assert.equal(Buffer.byteLength(publicNarration, "utf8"), 64 * 1024);
  assert.equal(Object.hasOwn(result, "visibleText"), false);
  assert.equal(result.visibleTextTruncated, true);
  assert.deepEqual(
    events.filter((event) => event.kind === "visible-text").map((event) => event.text).slice(0, 2),
    ["先读取 capacity、quota 和 model unavailable 说明。", "再写入 Candidate。"],
  );
  assert.deepEqual(
    events.filter((event) => event.kind === "visible-text").map((event) => event.messageId),
    ["qoder_message_001", "qoder_message_001", "qoder_message_001"],
  );
  assert.equal(events.filter((event) => event.kind === "visible-text-truncated").length, 1);
});

test("ACP stdio transport completes the same synthetic Candidate contract", async (t) => {
  const fixture = await createFixture(t);
  const candidate = identityPreservingCandidate(fixture, "ACP stdio Candidate");
  const scriptPath = await createStdioAgentScript(fixture);
  const result = await runQoderAcpTask({
    command: process.execPath,
    args: [scriptPath, JSON.stringify({
      requestPath: fixture.requestPath,
      manifestPath: fixture.manifestPath,
      outputPath: fixture.outputPath,
      finalizer: fixture.finalizer,
      candidate,
    })],
    policy: fixture.policy,
    prompt: "complete stdio fixture",
    startupTimeoutMs: 2_000,
    turnTimeoutMs: 3_000,
  });

  assert.equal(result.stopReason, "end_turn");
  assert.equal(result.initialized.agentInfo.name, "stemmio-stdio-agent");
  assert.equal(result.stderr, "");
  const status = await fixture.repository.requestStatus({
    target: fixture.target,
    ...IDENTITIES,
  });
  assert.equal(status.status, "candidate-ready");
  assert.equal(await readFile(fixture.sourcePath, "utf8"), fixture.sourceHtml);
  assert.equal(
    await readFile(fixture.target.exactSourcePath, "utf8"),
    fixture.managedSourceHtml,
  );
  await assert.rejects(
    runQoderAcpTask({
      command: process.execPath,
      args: [scriptPath, "{}"],
      policy: fixture.policy,
      prompt: "must not start",
      environment: { NODE_OPTIONS: "--require=untrusted" },
    }),
    /not allowed/u,
  );
});

test("ACP stdio transport runs a verified npm-style bundle with Finder's sparse PATH", async (t) => {
  const fixture = await createFixture(t);
  const candidate = identityPreservingCandidate(fixture, "Trusted runtime Candidate");
  const scriptPath = await createStdioAgentScript(fixture);
  const information = await stat(scriptPath);
  const expectedExecutable = {
    path: scriptPath,
    identity: {
      dev: information.dev,
      ino: information.ino,
      nlink: information.nlink,
      size: information.size,
      mtimeMs: information.mtimeMs,
      sha256: sha256(await readFile(scriptPath)),
    },
  };
  const result = await runQoderAcpTask({
    command: scriptPath,
    args: [JSON.stringify({
      requestPath: fixture.requestPath,
      manifestPath: fixture.manifestPath,
      outputPath: fixture.outputPath,
      finalizer: fixture.finalizer,
      candidate,
    })],
    policy: fixture.policy,
    prompt: "complete through the trusted JavaScript runtime",
    expectedExecutable,
    useVerifiedJavaScriptRuntime: true,
    baseEnvironment: {
      HOME: fixture.root,
      PATH: "/usr/bin:/bin",
    },
    startupTimeoutMs: 2_000,
    turnTimeoutMs: 3_000,
  });

  assert.equal(result.stopReason, "end_turn");
  assert.equal(result.initialized.agentInfo.name, "stemmio-stdio-agent");
  const status = await fixture.repository.requestStatus({
    target: fixture.target,
    ...IDENTITIES,
  });
  assert.equal(status.status, "candidate-ready");

  await assert.rejects(
    runQoderAcpTask({
      command: scriptPath,
      args: ["{}"],
      policy: fixture.policy,
      prompt: "must not spawn a drifted bundle",
      expectedExecutable: {
        ...expectedExecutable,
        identity: {
          ...expectedExecutable.identity,
          sha256: `sha256:${"0".repeat(64)}`,
        },
      },
      useVerifiedJavaScriptRuntime: true,
      baseEnvironment: { PATH: "/usr/bin:/bin" },
    }),
    (error) => error?.code === "ACP_AGENT_EXECUTABLE_CHANGED",
  );
});

test("verified JavaScript execution stays bound to the checked inode after path replacement", async (t) => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "stemmio-qoder-inode-bind-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "qodercli.js");
  const retired = path.join(root, "qodercli.checked.js");
  await writeFile(executable, `#!/usr/bin/env node
process.stdout.write("verified-old-bytes\\n");
`, { encoding: "utf8", mode: 0o755 });
  await chmod(executable, 0o755);
  const information = await stat(executable);
  const prepared = await prepareVerifiedQoderJavaScriptExecution({
    command: executable,
    expectedExecutable: {
      path: executable,
      identity: {
        dev: information.dev,
        ino: information.ino,
        nlink: information.nlink,
        size: information.size,
        mtimeMs: information.mtimeMs,
        sha256: sha256(await readFile(executable)),
      },
    },
    baseEnvironment: { PATH: "/usr/bin:/bin" },
  });

  await rename(executable, retired);
  await writeFile(executable, `#!/usr/bin/env node
process.stdout.write("unverified-replacement-bytes\\n");
`, { encoding: "utf8", mode: 0o755 });
  await chmod(executable, 0o755);

  const child = await prepared.spawn({
    args: [],
    cwd: root,
    stdin: "ignore",
  });
  child.stdout.setEncoding("utf8");
  let stdout = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });
  assert.equal(exitCode, 0);
  assert.equal(stdout, "verified-old-bytes\n");
  assert.doesNotMatch(stdout, /unverified-replacement/u);
});

test("verified preflight cleans same-group descendants before reporting success", async (t) => {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "stemmio-qoder-preflight-group-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "qodercli.js");
  const pidPath = path.join(root, "descendant.pid");
  await writeFile(executable, `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const descendant = spawn(process.execPath, ["--eval", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
});
writeFileSync(process.argv[2], String(descendant.pid));
descendant.unref();
process.stdout.write("1.1.27\\n");
`, { encoding: "utf8", mode: 0o755 });
  await chmod(executable, 0o755);
  const information = await stat(executable);
  const expectedExecutable = {
    path: executable,
    identity: {
      dev: information.dev,
      ino: information.ino,
      nlink: information.nlink,
      size: information.size,
      mtimeMs: information.mtimeMs,
      sha256: sha256(await readFile(executable)),
    },
  };
  const result = await runVerifiedQoderJavaScript({
    command: executable,
    expectedExecutable,
    args: [pidPath],
    cwd: root,
    baseEnvironment: { PATH: "/usr/bin:/bin" },
    timeoutMs: 3_000,
  });
  assert.equal(result.stdout, "1.1.27\n");
  const descendantPid = Number(await readFile(pidPath, "utf8"));
  t.after(() => {
    try {
      process.kill(descendantPid, "SIGKILL");
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  });
  // Process-group termination is confirmed by the supervisor; allow the OS
  // to reap the already-stopped orphan before asserting PID disappearance.
  assert.equal(await waitForProcessExit(descendantPid, 3_000), true);

  await assert.rejects(
    runVerifiedQoderJavaScript({
      command: executable,
      expectedExecutable,
      args: [pidPath],
      cwd: root,
      baseEnvironment: { PATH: "/usr/bin:/bin" },
      timeoutMs: 3_000,
      processTerminator: async () => false,
    }),
    (error) => error?.code === "ACP_PREFLIGHT_CLEANUP_UNCONFIRMED",
  );
  const unconfirmedPid = Number(await readFile(pidPath, "utf8"));
  try {
    process.kill(unconfirmedPid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
});

test("verified JavaScript execution uses Electron as Node without inheriting Finder PATH", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "stemmio-qoder-electron-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const executable = path.join(root, "qodercli.js");
  const runner = path.join(root, "electron-runner.mjs");
  await writeFile(executable, `#!/usr/bin/env node
process.stdout.write(JSON.stringify({
  electron: process.versions.electron || null,
  runAsNode: process.env.ELECTRON_RUN_AS_NODE || null,
}) + "\\n");
`, { encoding: "utf8", mode: 0o755 });
  await chmod(executable, 0o755);
  const clientModuleUrl = pathToFileURL(path.join(
    productRoot,
    "bridge",
    "qoder-acp-client.mjs",
  )).href;
  await writeFile(runner, `import { readFile, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { runVerifiedQoderJavaScript } from ${JSON.stringify(clientModuleUrl)};
const command = await realpath(process.env.STEMMIO_TEST_QODER_COMMAND);
const information = await stat(command);
const bytes = await readFile(command);
const result = await runVerifiedQoderJavaScript({
  command,
  expectedExecutable: {
    path: command,
    identity: {
      dev: information.dev,
      ino: information.ino,
      nlink: information.nlink,
      size: information.size,
      mtimeMs: information.mtimeMs,
      sha256: "sha256:" + createHash("sha256").update(bytes).digest("hex"),
    },
  },
  baseEnvironment: { HOME: process.env.STEMMIO_TEST_HOME, PATH: "/usr/bin:/bin" },
  timeoutMs: 5_000,
});
process.stdout.write(JSON.stringify({
  parentElectron: process.versions.electron || null,
  child: JSON.parse(result.stdout),
}));
`, "utf8");

  const electronPath = require("electron");
  const result = await execFileAsync(electronPath, [runner], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      STEMMIO_TEST_HOME: root,
      STEMMIO_TEST_QODER_COMMAND: executable,
    },
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
  const payload = JSON.parse(result.stdout);
  assert.match(payload.parentElectron, /^\d+\./u);
  assert.equal(payload.child.electron, payload.parentElectron);
  assert.equal(payload.child.runAsNode, "1");
});

test("ACP stdio transport accepts a valid completed turn before immediate Agent exit", async (t) => {
  const fixture = await createFixture(t);
  const candidate = identityPreservingCandidate(fixture, "Immediate exit Candidate");
  const scriptPath = await createStdioAgentScript(fixture);
  const result = await runQoderAcpTask({
    command: process.execPath,
    args: [scriptPath, JSON.stringify({
      requestPath: fixture.requestPath,
      manifestPath: fixture.manifestPath,
      outputPath: fixture.outputPath,
      finalizer: fixture.finalizer,
      candidate,
      exitAfterStop: true,
    })],
    policy: fixture.policy,
    prompt: "complete and exit immediately",
    startupTimeoutMs: 2_000,
    turnTimeoutMs: 3_000,
  });

  assert.equal(result.stopReason, "end_turn");
  assert.equal(result.completion.outputSha256, sha256(Buffer.from(candidate, "utf8")));
  const status = await fixture.repository.requestStatus({
    target: fixture.target,
    ...IDENTITIES,
  });
  assert.equal(status.status, "candidate-ready");
});

test("ACP stdio transport binds the preflight executable identity before spawn", async (t) => {
  const fixture = await createFixture(t);
  await assert.rejects(
    runQoderAcpTask({
      command: process.execPath,
      args: ["--version"],
      policy: fixture.policy,
      prompt: "must not spawn",
      expectedExecutable: {
        path: process.execPath,
        identity: {
          dev: -1,
          ino: -1,
          nlink: 1,
          size: 0,
          mtimeMs: 0,
          sha256: `sha256:${"0".repeat(64)}`,
        },
      },
    }),
    (error) => error?.code === "ACP_AGENT_EXECUTABLE_CHANGED",
  );
});

test("ACP stdio transport fails immediately on process errors and cleans orphaned groups", async (t) => {
  const fixture = await createFixture(t);
  const invalidExecutable = path.join(fixture.root, "missing-interpreter-agent");
  await writeFile(invalidExecutable, "#!/stemmio/definitely-missing-interpreter\n", "utf8");
  await chmod(invalidExecutable, 0o700);
  await assert.rejects(
    runQoderAcpTask({
      command: invalidExecutable,
      args: [],
      policy: fixture.policy,
      prompt: "must fail at spawn",
      startupTimeoutMs: 5_000,
      turnTimeoutMs: 5_000,
    }),
    (error) => error?.code === "ACP_AGENT_PROCESS_ERROR",
  );

  if (process.platform === "win32") return;
  const pidPath = path.join(fixture.root, "grandchild.pid");
  const earlyExitScript = path.join(fixture.root, "early-exit-agent.mjs");
  await writeFile(earlyExitScript, `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  stdio: "ignore",
});
writeFileSync(process.argv[2], String(grandchild.pid));
grandchild.unref();
process.exit(7);
`, "utf8");
  const startedAt = Date.now();
  await assert.rejects(
    runQoderAcpTask({
      command: process.execPath,
      args: [earlyExitScript, pidPath],
      policy: fixture.policy,
      prompt: "must fail on early exit",
      startupTimeoutMs: 10_000,
      turnTimeoutMs: 10_000,
    }),
    (error) => error?.code === "ACP_AGENT_EXITED_EARLY",
  );
  assert.ok(Date.now() - startedAt < 5_000, "early exit waited for the ACP startup timeout");
  const grandchildPid = Number(await readFile(pidPath, "utf8"));
  t.after(() => {
    if (processExists(grandchildPid)) process.kill(grandchildPid, "SIGKILL");
  });
  assert.equal(
    await waitForProcessExit(grandchildPid, 3_000),
    true,
    "the detached ACP process group retained a grandchild",
  );
});

test("ACP stdio transport rejects invalid UTF-8 and oversized unterminated frames", async (t) => {
  const fixture = await createFixture(t);
  const invalidUtf8 = await createRawStdoutScript(
    fixture,
    "invalid-utf8-agent",
    "process.stdout.write(Buffer.from([0xff, 0x0a]));",
  );
  await assert.rejects(
    runQoderAcpTask({
      command: process.execPath,
      args: [invalidUtf8],
      policy: fixture.policy,
      prompt: "invalid utf8",
      startupTimeoutMs: 2_000,
      turnTimeoutMs: 2_000,
    }),
    (error) => error?.code === "ACP_UTF8_INVALID",
  );

  const oversizedFrame = await createRawStdoutScript(
    fixture,
    "oversized-frame-agent",
    "process.stdout.write(Buffer.alloc(23 * 1024 * 1024, 0x61));",
  );
  await assert.rejects(
    runQoderAcpTask({
      command: process.execPath,
      args: [oversizedFrame],
      policy: fixture.policy,
      prompt: "oversized frame",
      startupTimeoutMs: 5_000,
      turnTimeoutMs: 2_000,
    }),
    (error) => error?.code === "ACP_FRAME_TOO_LARGE",
  );
});

test("ACP stop reason cannot replace Candidate finalization evidence", async (t) => {
  const fixture = await createFixture(t);
  const agent = acp
    .agent({ name: "stemmio-early-stop-agent" })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      authMethods: [],
    }))
    .onRequest(acp.methods.agent.session.new, () => ({ sessionId: "session_early_stop" }))
    .onRequest(acp.methods.agent.session.prompt, () => ({ stopReason: "end_turn" }));

  await assert.rejects(
    runAcpTask({
      connection: agent,
      policy: fixture.policy,
      prompt: "stop too early",
      startupTimeoutMs: 1_000,
      turnTimeoutMs: 1_000,
    }),
    (error) => error?.code === "ACP_FINALIZER_NOT_COMPLETED",
  );
});

test("the execution driver profile fails closed on a host without completion proof", async (t) => {
  const fixture = await createFixture(t);
  // `runAcpTask` resolves this exact profile from the branded policy and applies
  // `assertHost` to whatever the profile builds, so these are the driver's own
  // execution-path rules, not a parallel copy of them.
  const profile = acpDriverProfile(fixture.policy);

  assert.equal(fixture.policy.mode, "execution");
  assert.equal(profile.mode, "execution");
  assert.equal(profile.requiresTurnCompletion, true);
  // Execution narration stays bounded so a user can distinguish progress from a
  // stuck round without giving prose any Candidate authority.
  assert.equal(profile.visibleTextByteLimit, 64 * 1024);
  assert.deepEqual(profile.clientCapabilities, {
    fs: { readTextFile: true, writeTextFile: true },
    terminal: true,
  });

  const host = profile.assertHost(profile.createHost(fixture.policy, () => {}));
  assert.equal(typeof host.assertTurnCompleted, "function");
  await host.dispose();

  // A host that lost `assertTurnCompleted` to a rename must be refused before
  // the turn runs. The alternative — calling it optionally — would let an
  // execution turn silently skip its finalizer proof.
  assert.throws(
    () => profile.assertHost({ ...host, assertTurnCompleted: undefined }),
    (error) => error?.code === "ACP_HOST_CONTRACT_INCOMPLETE"
      && error.details.missing.includes("assertTurnCompleted"),
  );

});

test("ACP turn timeout fails closed and requests session cancellation", async (t) => {
  const fixture = await createFixture(t);
  let releasePrompt;
  let cancelled = false;
  const agent = acp
    .agent({ name: "stemmio-timeout-agent" })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      authMethods: [],
    }))
    .onRequest(acp.methods.agent.session.new, () => ({ sessionId: "session_timeout" }))
    .onRequest(acp.methods.agent.session.prompt, () => new Promise((resolve) => {
      releasePrompt = resolve;
    }))
    .onNotification(acp.methods.agent.session.cancel, () => {
      cancelled = true;
      releasePrompt?.({ stopReason: "cancelled" });
    });

  await assert.rejects(
    runAcpTask({
      connection: agent,
      policy: fixture.policy,
      prompt: "wait",
      startupTimeoutMs: 1_000,
      turnTimeoutMs: 30,
    }),
    (error) => error?.code === "AGENT_TURN_TIMEOUT",
  );
  assert.equal(cancelled, true);
});

test("ACP activity watchdog allows a turn to run beyond one window without exposing thought text", async (t) => {
  const fixture = await createFixture(t);
  const sessionId = "session_activity";
  const events = [];
  const host = {
    bindSessionId() {},
    requestPermission: async () => ({ outcome: { outcome: "selected", optionId: "allow" } }),
    readTextFile: async () => ({ content: "" }),
    writeTextFile: async () => {},
    createTerminal: async () => ({ terminalId: "terminal_activity" }),
    terminalOutput: async () => ({ output: "" }),
    waitForTerminalExit: async () => ({ exitCode: 0, signal: null }),
    killTerminal: async () => {},
    releaseTerminal: async () => {},
    cancel: async () => {},
    dispose: async () => {},
    assertTurnCompleted: async () => {},
  };
  const agent = acp
    .agent({ name: "stemmio-activity-agent" })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      authMethods: [],
      agentInfo: { name: "stemmio-activity-agent", version: "1.0.0" },
    }))
    .onRequest(acp.methods.agent.session.new, () => ({ sessionId }))
    .onRequest(acp.methods.agent.session.prompt, async ({ client }) => {
      for (let index = 0; index < 5; index += 1) {
        await client.notify(acp.methods.client.session.update, {
          sessionId,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "hidden thought" },
          },
        });
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      return { stopReason: "end_turn" };
    });

  const result = await runGenericAcpTask({
    connection: agent,
    policy: fixture.policy,
    prompt: "activity",
    createHost: () => host,
    onEvent: (event) => events.push(event),
    startupTimeoutMs: 1_000,
    turnTimeoutMs: 20,
  });
  assert.equal(result.stopReason, "end_turn");
  assert.equal(Object.hasOwn(result, "visibleText"), false);
  assert.equal(events.some((event) => event.kind === "visible-text"), false);
});

test("ACP activity watchdog permits valid protocol activity beyond 45 virtual minutes", async (t) => {
  const fixture = await createFixture(t);
  const timer = createVirtualTimer();
  const sessionId = "session_long_activity";
  const host = {
    bindSessionId() {},
    requestPermission: async () => ({ outcome: { outcome: "selected", optionId: "allow" } }),
    readTextFile: async () => ({ content: "" }),
    writeTextFile: async () => {},
    createTerminal: async () => ({ terminalId: "terminal_long_activity" }),
    terminalOutput: async () => ({ output: "" }),
    waitForTerminalExit: async () => ({ exitCode: 0, signal: null }),
    killTerminal: async () => {},
    releaseTerminal: async () => {},
    cancel: async () => {},
    dispose: async () => {},
    assertTurnCompleted: async () => {},
  };
  const agent = acp
    .agent({ name: "stemmio-long-activity-agent" })
    .onRequest(acp.methods.agent.initialize, () => ({
      protocolVersion: acp.PROTOCOL_VERSION,
      agentCapabilities: { loadSession: false },
      authMethods: [],
      agentInfo: { name: "stemmio-long-activity-agent", version: "1.0.0" },
    }))
    .onRequest(acp.methods.agent.session.new, () => ({ sessionId }))
    .onRequest(acp.methods.agent.session.prompt, async ({ client }) => {
      for (let index = 0; index < 4; index += 1) {
        timer.advance(20 * 60_000);
        await client.notify(acp.methods.client.session.update, {
          sessionId,
          update: {
            sessionUpdate: "agent_thought_chunk",
            content: { type: "text", text: "hidden thought" },
          },
        });
      }
      return { stopReason: "end_turn" };
    });

  const result = await runGenericAcpTask({
    connection: agent,
    policy: fixture.policy,
    prompt: "long activity",
    createHost: () => host,
    startupTimeoutMs: 1_000,
    inactivityTimeoutMs: DEFAULT_ACP_TURN_TIMEOUT_MS,
    clock: timer.clock,
    scheduler: timer.scheduler,
  });
  assert.equal(result.stopReason, "end_turn");
  assert.equal(Object.hasOwn(result, "visibleText"), false);
  assert.ok(timer.now() > DEFAULT_ACP_TURN_TIMEOUT_MS);
});

test("external cancellation closes the ACP mutation surface and terminates stdio", async (t) => {
  const fixture = await createFixture(t);
  const scriptPath = await createStdioAgentScript(fixture);
  const controller = new AbortController();
  const running = runQoderAcpTask({
    command: process.execPath,
    args: [scriptPath, JSON.stringify({
      requestPath: fixture.requestPath,
      hang: true,
    })],
    policy: fixture.policy,
    prompt: "wait for cancellation",
    cancellationSignal: controller.signal,
    startupTimeoutMs: 2_000,
    turnTimeoutMs: 10_000,
  });
  setTimeout(() => controller.abort(new Error("cancel test")), 150);
  await assert.rejects(
    running,
    (error) => error?.code === "ACP_CANCELLED",
  );
});

for (const provider of ["codex", "qoder"]) {
  test(`${provider} ACP automatically resumes identity rejection in the same session`, async (t) => {
    const fixture = await createFixture(t);
    const observed = { rejectIdentity: true, agentName: provider };
    const result = await runGenericAcpTask({
      connection: createSyntheticAgent(fixture, observed), policy: fixture.policy,
      prompt: "Change text while preserving identities", startupTimeoutMs: 5000, turnTimeoutMs: 5000,
      expectedAgentName: new RegExp(`^${provider}$`, "u"),
    });
    assert.equal(observed.promptCount, 2);
    assert.equal(result.stopReason, "end_turn");
    assert.equal(await readFile(fixture.target.exactSourcePath, "utf8"), fixture.managedSourceHtml);
    assert.match(await readFile(fixture.outputPath, "utf8"), /ACP Candidate/u);
  });
}

test("ACP identity repair exhausts three rejected writes without output or completion", async (t) => {
  const fixture = await createFixture(t);
  const observed = { rejectIdentity: true, alwaysRejectIdentity: true };
  await assert.rejects(runGenericAcpTask({
    connection: createSyntheticAgent(fixture, observed), policy: fixture.policy,
    prompt: "Change text", startupTimeoutMs: 5000, turnTimeoutMs: 5000,
  }), { code: "AGENT_OUTPUT_INVALID" });
  assert.equal(observed.promptCount, 3);
  await assert.rejects(readFile(fixture.outputPath), { code: "ENOENT" });
  await assert.rejects(readFile(fixture.completionPath), { code: "ENOENT" });
});

test("Codex frozen model and effort are applied before prompt; rejection prevents spending", async (t) => {
  const fixture = await createFixture(t);
  for (const reject of [false, true]) {
    const calls = [];
    const agent = acp.agent({ name: "codex-selection-fixture" })
      .onRequest(acp.methods.agent.initialize, () => ({ protocolVersion: acp.PROTOCOL_VERSION,
        agentCapabilities: {}, authMethods: [], agentInfo: { name: "codex-selection-fixture", version: "1" } }))
      .onRequest(acp.methods.agent.session.new, () => ({ sessionId: "session_model" }))
      .onRequest("session/set_model", (value) => value, ({ params }) => {
        calls.push(params.modelId);
        if (reject) throw new Error("model unavailable");
        return {};
      })
      .onRequest(acp.methods.agent.session.prompt, () => { calls.push("prompt"); return { stopReason: "end_turn" }; });
    const result = runGenericAcpTask({ connection: agent, policy: fixture.policy, prompt: "synthetic",
      sessionModelId: "gpt-synthetic[high]", createHost: () => ({
        ...Object.fromEntries(["requestPermission", "readTextFile", "writeTextFile", "createTerminal", "terminalOutput", "waitForTerminalExit", "killTerminal", "releaseTerminal"].map((key) => [key, async () => { throw new Error("unexpected tool call"); }])),
        bindSessionId() {}, assertTurnCompleted: async () => {}, dispose: async () => {}, cancel: async () => {},
      }) });
    if (reject) await assert.rejects(result, { code: -32603 });
    else await result;
    assert.deepEqual(calls, reject ? ["gpt-synthetic[high]"] : ["gpt-synthetic[high]", "prompt"]);
  }
});

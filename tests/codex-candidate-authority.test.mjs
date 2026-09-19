import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { loadExecutionPolicy } from "../bridge/agent/policies/execution-policy.mjs";
import { createDefaultProviderRegistry } from "../bridge/agent/providers/provider-registry.mjs";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";
import { inspectSourceElementIdentity } from "../bridge/project-file-repository/working-copy.mjs";
import { normalizeAgentDelivery } from "../shared/agent-delivery.mjs";
import { compileTaskSpec } from "../shared/task-spec.mjs";

const acpFixture = fileURLToPath(new URL(
  "./fixtures/codex-acp-agent.mjs",
  import.meta.url,
));

async function createSyntheticCodexInstallation(root, nativeMode = null) {
  const command = path.join(root, "codex-acp-synthetic");
  await writeFile(
    command,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(acpFixture)} "$@"\n`,
    { mode: 0o755 },
  );
  if (nativeMode) {
    const nativeFixture = fileURLToPath(new URL("./fixtures/codex-client-tools-server.mjs", import.meta.url));
    await writeFile(command, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(nativeFixture)} --mode=${nativeMode} "$@"\n`, { mode: 0o755 });
  }
  const executable = await realpath(command);
  const information = await lstat(executable);
  const result = {
    command: executable,
    version: "1.7.0",
    identity: Object.freeze({
      dev: information.dev,
      ino: information.ino,
      nlink: information.nlink,
      size: information.size,
      mtimeMs: information.mtimeMs,
      sha256: sha256(await readFile(command)),
    }),
    source: nativeMode ? "verified-npm-package" : "e2e-override",
    nodeModulesRoot: null,
    nativeIdentity: null,
  };
  return Object.freeze(nativeMode ? { ...result, nativeCommand: executable, nativeIdentity: result.identity } : result);
}

function finalizerPrompt(policy) {
  const terminalRequest = {
    command: policy.finalizer.command,
    args: [...policy.finalizer.args],
    cwd: policy.finalizer.cwd,
    env: Object.entries(policy.finalizer.env).map(([name, value]) => ({ name, value })),
  };
  return [
    "Complete this single frozen Stemmio task.",
    `Read ${policy.manifestPath} and then every file in its exact readOrder.`,
    `Follow ${policy.promptPath}.`,
    `Write one complete HTML document only to ${policy.outputPath}.`,
    "Then invoke ACP terminal/create exactly once with this JSON request:",
    JSON.stringify(terminalRequest),
    "Do not use a shell wrapper or write any other path.",
    "The result remains a Candidate pending Stemmio review and must not replace the Working Copy.",
  ].join("\n");
}

for (const nativeMode of [null, "complete", "missing-finalizer"]) test(`Codex ${nativeMode || "upstream ACP"} preserves Candidate authority and the Working Copy`, async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-candidate-authority-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "sources");
  const sourcePath = path.join(sourceRoot, "page.html");
  const source = "<!doctype html><html><head><title>Before</title></head><body>Before</body></html>\n";
  await mkdir(sourceRoot, { recursive: true });
  await writeFile(sourcePath, source, "utf8");
  const repository = new ProjectFileRepository({
    projectsRoot: path.join(root, "projects"),
    agentDeliveryNormalizer(value) {
      return normalizeAgentDelivery(value);
    },
  });
  const imported = await repository.importExternal({
    sourcePath,
    expectedSourceSha256: sha256(Buffer.from(source)),
  });
  const managedSourceBefore = await readFile(imported.target.exactSourcePath, "utf8");
  assert.equal(inspectSourceElementIdentity(managedSourceBefore).complete, true);
  const selection = {
    providerId: "codex",
    runtimeId: "acp",
    requestedModelId: null,
    resolvedModelId: "codex:gpt-synthetic",
    reasoning: { requested: null, applied: null, resolution: "provider-default" },
  };
  const comments = [{
    commentId: "comment_codex_candidate",
    text: "Modify the page through Codex",
    target: { targetId: "target_codex_candidate" },
    attachments: [],
  }];
  const targets = [{ targetId: "target_codex_candidate" }];
  const request = await repository.prepareRequest({
    target: imported.target,
    requestId: "req_codex_candidate_authority",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: {
      freezeCutoffRevision: 0,
      summary: "Modify the page through Codex",
      comments,
      changeEvents: [],
      targets,
      taskSpec: compileTaskSpec({ comments, targets }),
      agentDelivery: {
        mode: "managed-agent",
        selection,
        trustPolicyVersion: "trusted-local-agent-v1",
      },
    },
    prompt: "Write one complete Candidate page.",
  });
  const requestRoot = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "requests",
    request.requestId,
  );
  const outputPath = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    ...request.outputRelativePath.split("/"),
  );
  const policy = await loadExecutionPolicy({
    requestPath: requestRoot,
    promptPath: path.join(requestRoot, "PROMPT.md"),
    outputPath,
    completionPath: path.join(requestRoot, "attempts", request.attemptId, "completion.json"),
  });
  const installation = await createSyntheticCodexInstallation(root, nativeMode);
  const registry = createDefaultProviderRegistry({
    codexCommandResolver: async () => installation,
    codexPreflightRunner: async () => Object.freeze({
      version: "1.7.0",
      protocol: "acp",
      authMode: "ready",
      modelCount: 1,
      models: Object.freeze([Object.freeze({
        id: "codex:gpt-synthetic",
        providerModelId: "gpt-synthetic",
        displayName: "GPT Synthetic",
        reasoningEfforts: Object.freeze([]),
        defaultReasoningEffort: null,
        isDefault: true,
      })]),
    }),
  });
  const ticket = await registry.preflightForSelection(selection, "execution", {
    environment: {},
  });
  const run = registry.run(ticket, {
    policy,
    prompt: finalizerPrompt(policy),
    baseEnvironment: process.env,
    onEvent() {},
  });
  if (nativeMode === "missing-finalizer") {
    await assert.rejects(run, /finalizer|finaliz|completion/i);
    const failed = await repository.requestStatus({ target: imported.target, requestId: request.requestId, attemptId: request.attemptId });
    assert.notEqual(failed.status, "candidate-ready");
    assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), managedSourceBefore);
    return;
  }
  const result = await run;
  assert.equal(result.stopReason, "end_turn");
  const status = await repository.requestStatus({
    target: imported.target,
    requestId: request.requestId,
    attemptId: request.attemptId,
  });
  assert.equal(status.status, "candidate-ready");
  assert.equal(status.candidate.candidateId, request.candidateId);
  assert.equal(await readFile(sourcePath, "utf8"), source);
  assert.equal(
    await readFile(imported.target.exactSourcePath, "utf8"),
    managedSourceBefore,
  );
  const workspace = await repository.workspace({ sourcePath: imported.target.exactSourcePath });
  assert.equal(workspace.manifest.latestOfficialVersionId, "ver_0001");
  assert.equal(workspace.manifest.versions.length, 1);
  assert.equal(workspace.activeCandidate.candidateId, request.candidateId);
});

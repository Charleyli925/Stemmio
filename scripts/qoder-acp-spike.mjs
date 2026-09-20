#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parse } from "parse5";

import { loadExecutionPolicy } from "../bridge/agent/policies/execution-policy.mjs";
import { runAcpProcessTask } from "../bridge/agent/runtimes/acp-process.mjs";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";
import { projectControlPath } from "../shared/project-storage-contract.mjs";
import { compileTaskSpec } from "../shared/task-spec.mjs";
import { captureAcpReviewBoundary } from "./qoder-acp-spike-support.mjs";

const productRoot = fileURLToPath(new URL("../", import.meta.url));
const finalizerPath = fileURLToPath(new URL("../bridge/finalize-attempt.mjs", import.meta.url));
const reportPath = path.join(productRoot, "output", "qoder-acp-spike", "report.json");
const candidateMarker = "data-stemmio-qoder-acp=\"verified\"";
const MAX_RETAINED_EVENTS = 2_048;
const partialEvidence = { qoder: null, events: [], droppedEvents: 0 };
const sourceHtml = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Stemmio ACP Before</title>
</head>
<body>
  <main><h1>Before Qoder ACP</h1></main>
</body>
</html>
`;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function executable(candidate) {
  try {
    const canonical = await realpath(candidate);
    await access(canonical, fsConstants.X_OK);
    return canonical;
  } catch {
    return null;
  }
}

async function resolveQoderCommand() {
  const configured = process.env.STEMMIO_QODER_ACP_COMMAND;
  if (configured) {
    if (!path.isAbsolute(configured)) {
      throw fail(
        "QODER_COMMAND_NOT_ABSOLUTE",
        "STEMMIO_QODER_ACP_COMMAND must be an absolute executable path.",
      );
    }
    const resolved = await executable(configured);
    if (!resolved) throw fail("QODER_COMMAND_NOT_EXECUTABLE", "Configured Qoder CLI is not executable.");
    return resolved;
  }
  const pathDirectories = String(process.env.PATH || "")
    .split(path.delimiter)
    .filter((directory) => directory && path.isAbsolute(directory));
  for (const name of ["qodercli", "qoder"]) {
    for (const directory of pathDirectories) {
      const resolved = await executable(path.join(directory, name));
      if (resolved) return resolved;
    }
  }
  throw fail(
    "QODER_COMMAND_NOT_FOUND",
    "No Qoder CLI was found. Set STEMMIO_QODER_ACP_COMMAND to its absolute path.",
  );
}

function countEvents(events) {
  const counts = {};
  for (const event of events) {
    const key = event.kind === "session-update"
      ? `session-update:${event.type}`
      : event.kind;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function retainEvent(target, event) {
  if (target.events.length < MAX_RETAINED_EVENTS) target.events.push(event);
  else target.droppedEvents += 1;
}

async function writeSafeReport(report) {
  const directory = path.dirname(reportPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const canonicalDirectory = await realpath(directory);
  const canonicalOutput = await realpath(path.join(productRoot, "output"));
  if (
    canonicalDirectory !== canonicalOutput
    && !canonicalDirectory.startsWith(`${canonicalOutput}${path.sep}`)
  ) {
    throw fail("REPORT_PATH_UNSAFE", "The ACP report directory escapes Stemmio output.");
  }
  const target = path.join(canonicalDirectory, path.basename(reportPath));
  const temporary = `${target}.${randomUUID()}.tmp`;
  const handle = await open(
    temporary,
    fsConstants.O_WRONLY
      | fsConstants.O_CREAT
      | fsConstants.O_EXCL
      | (fsConstants.O_NOFOLLOW || 0),
    0o600,
  );
  try {
    await handle.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, target);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

function assert(condition, code, message) {
  if (!condition) throw fail(code, message);
}

function elementsByName(root, name) {
  const matches = [];
  const visit = (node) => {
    if (node?.nodeName === name) matches.push(node);
    for (const child of node?.childNodes || []) visit(child);
  };
  visit(root);
  return matches;
}

function textContent(node) {
  if (node?.nodeName === "#text") return String(node.value || "");
  return (node?.childNodes || []).map(textContent).join("");
}

async function run() {
  const qoderCommand = await resolveQoderCommand();
  const temporaryRoot = await realpath(
    await mkdtemp(path.join(tmpdir(), "stemmio-qoder-acp-live-")),
  );
  try {
    const sourcesRoot = path.join(temporaryRoot, "sources");
    const projectsRoot = path.join(temporaryRoot, "projects");
    await mkdir(sourcesRoot, { recursive: true });
    const externalSourcePath = path.join(sourcesRoot, "synthetic-acp.html");
    await writeFile(externalSourcePath, sourceHtml, "utf8");

    const repository = new ProjectFileRepository({ projectsRoot });
    const imported = await repository.importExternal({
      sourcePath: externalSourcePath,
      expectedSourceSha256: sha256(Buffer.from(sourceHtml, "utf8")),
    });
    const { target } = imported;
    assert(
      typeof target.versionId === "string" && target.versionId.length > 0,
      "INITIAL_VERSION_MISSING",
      "The synthetic Project File has no initial Version identity.",
    );
    const projectRoot = await realpath(target.projectRootPath);
    const workingCopyBefore = await captureAcpReviewBoundary({
      repository,
      target,
      projectRoot,
    });
    const requestId = `req_qoder_acp_${randomUUID().replaceAll("-", "")}`;
    const attemptId = "attempt_001";
    const requestPath = projectControlPath(projectRoot, "requests", requestId);
    const outputPath = path.join(
      requestPath,
      "attempts",
      attemptId,
      "output",
      "candidate.html",
    );
    const completionPath = path.join(
      requestPath,
      "attempts",
      attemptId,
      "completion.json",
    );
    const finalizer = {
      command: await realpath(process.execPath),
      args: [
        await realpath(finalizerPath),
        "--project-root",
        projectRoot,
        "--request-id",
        requestId,
        "--attempt-id",
        attemptId,
      ],
      cwd: requestPath,
      env: {},
    };
    const prompt = `# Stemmio Qoder ACP synthetic task

This is synthetic validation data. Read input-manifest.json in its exact readOrder.
Modify the complete frozen HTML so that the body has the exact attribute
${candidateMarker} and the h1 text is exactly Qoder ACP Candidate.
Preserve the rest of the document and write one complete HTML document only to:
${outputPath}

After the write succeeds, invoke terminal/create once with this exact structured request:

- command: ${JSON.stringify(finalizer.command)}
- args: ${JSON.stringify(finalizer.args)}
- cwd: ${JSON.stringify(finalizer.cwd)}
- env: []

Do not use a shell wrapper and do not write any other path. The result remains a
Candidate pending Stemmio review; it must not replace or adopt the Working Copy.
`;
    const taskSpecComments = [{
      commentId: "comment_qoder_acp",
      text: "完成合成 Qoder ACP 验证，并只修改目标页面。",
      target: { targetId: "target_qoder_acp" },
      attachments: [],
    }];
    const taskSpecTargets = [{
      targetId: "target_qoder_acp",
      selector: "body",
      level: "module",
    }];
    const taskSpec = compileTaskSpec({
      comments: taskSpecComments,
      targets: taskSpecTargets,
    });
    const request = await repository.prepareRequest({
      target,
      requestId,
      attemptId,
      expectedSourceSha256: target.sourceSha256,
      request: {
        freezeCutoffRevision: 0,
        taskSpec,
        comments: taskSpecComments,
        changeEvents: [],
      },
      prompt,
    });
    const canonicalRequestPath = await realpath(requestPath);
    assert(
      canonicalRequestPath === requestPath,
      "REQUEST_PATH_NOT_CANONICAL",
      "The synthetic Request path was not canonical.",
    );
    const policy = await loadExecutionPolicy({
      requestPath,
      promptPath: path.join(requestPath, "PROMPT.md"),
      outputPath,
      completionPath,
    });
    assert(
      policy.finalizer.command === finalizer.command
      && policy.finalizer.cwd === finalizer.cwd
      && JSON.stringify(policy.finalizer.args) === JSON.stringify(finalizer.args),
      "FINALIZER_PROMPT_DRIFT",
      "The frozen prompt finalizer does not match the derived policy finalizer.",
    );
    const events = [];
    const result = await runAcpProcessTask({
      command: qoderCommand,
      args: ["--acp"],
      policy,
      prompt: `Complete the frozen synthetic Stemmio task at ${policy.promptPath}.`,
      onEvent: (event) => {
        if (event.kind === "initialized" && event.agentName !== "qoder-cli") {
          throw fail(
            "QODER_AGENT_IDENTITY_MISMATCH",
            "The selected ACP executable did not identify itself as Qoder CLI.",
          );
        }
        if (events.length < MAX_RETAINED_EVENTS) events.push(event);
        retainEvent(partialEvidence, event);
        if (event.kind === "initialized") {
          partialEvidence.qoder = {
            protocolVersion: event.protocolVersion,
            agentName: event.agentName,
            agentVersion: event.agentVersion,
          };
        }
      },
    });

    assert(result.stopReason === "end_turn", "QODER_TURN_NOT_COMPLETE", "Qoder did not end the ACP turn cleanly.");
    const status = await repository.requestStatus({ target, requestId, attemptId });
    assert(status.status === "candidate-ready", "CANDIDATE_NOT_READY", "Stemmio did not seal a reviewable Candidate.");
    assert(
      status.candidate?.status === "pending-review",
      "CANDIDATE_NOT_PENDING_REVIEW",
      "The sealed Candidate is not waiting for explicit review.",
    );
    const candidate = await repository.readCandidate({
      target,
      candidateId: request.candidateId,
    });
    const candidateDocument = parse(candidate.content);
    const bodies = elementsByName(candidateDocument, "body");
    const headings = elementsByName(candidateDocument, "h1");
    assert(
      bodies.length === 1
      && bodies[0].attrs?.some((attribute) => (
        attribute.name === "data-stemmio-qoder-acp"
        && attribute.value === "verified"
      )),
      "CANDIDATE_MARKER_MISSING",
      "Qoder did not make the exact synthetic body-attribute change.",
    );
    assert(
      headings.length === 1 && textContent(headings[0]).trim() === "Qoder ACP Candidate",
      "CANDIDATE_HEADING_MISSING",
      "Qoder did not make the requested synthetic heading change.",
    );
    assert(
      await readFile(target.exactSourcePath, "utf8") === sourceHtml,
      "WORKING_COPY_CHANGED",
      "The Working Copy changed before review.",
    );
    assert(
      await readFile(externalSourcePath, "utf8") === sourceHtml,
      "EXTERNAL_SOURCE_CHANGED",
      "The synthetic external source changed during the ACP run.",
    );
    const workingCopyAfter = await captureAcpReviewBoundary({
      repository,
      target,
      projectRoot,
    });
    assert(
      JSON.stringify(workingCopyAfter) === JSON.stringify(workingCopyBefore),
      "WORKING_COPY_STATE_CHANGED",
      "The Working Copy, its base Version, or its Version manifest changed before review.",
    );

    const report = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      mode: "synthetic-live-qoder-acp-v1",
      boundary: "cooperative-protocol-host-not-os-sandbox",
      qoder: {
        protocolVersion: result.initialized.protocolVersion,
        agentName: result.initialized.agentInfo?.name || "unknown",
        agentVersion: result.initialized.agentInfo?.version || "unknown",
      },
      outcome: {
        stopReason: result.stopReason,
        completionStatus: result.completion.status,
        candidateReady: true,
        markerVerified: true,
        workingCopyPreserved: true,
        versionAdopted: false,
        outputSha256: result.completion.outputSha256,
      },
      eventCounts: countEvents(events),
      eventsTruncated: partialEvidence.droppedEvents > 0,
    };
    await writeSafeReport(report);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

run().catch(async (cause) => {
  const rawMessage = String(cause?.message || cause || "Qoder ACP spike failed.");
  const capacityUnavailable = /pricingUrl|credit usage limit|upgrade your subscription/iu
    .test(rawMessage);
  const code = capacityUnavailable
    ? "QODER_ACCOUNT_CAPACITY_UNAVAILABLE"
    : String(cause?.code || "QODER_ACP_SPIKE_FAILED");
  const message = capacityUnavailable
    ? "The signed-in Qoder account has no model capacity available for this ACP validation."
    : rawMessage;
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    mode: "synthetic-live-qoder-acp-v1",
    boundary: "cooperative-protocol-host-not-os-sandbox",
    outcome: {
      status: "blocked",
      errorCode: code,
    },
    ...(partialEvidence.qoder ? { qoder: partialEvidence.qoder } : {}),
    eventCounts: countEvents(partialEvidence.events),
    eventsTruncated: partialEvidence.droppedEvents > 0,
  };
  await writeSafeReport(report);
  process.stderr.write(`${code}: ${message}\n`);
  process.exitCode = 1;
});

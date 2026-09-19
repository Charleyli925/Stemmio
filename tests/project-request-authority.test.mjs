import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import { normalizeAgentDelivery } from "../shared/agent-delivery.mjs";
import { compileTaskSpec } from "../shared/task-spec.mjs";
import {
  ProjectFileRepository,
  ProjectFileRepositoryError,
} from "../bridge/project-file-repository.mjs";
import {
  FROZEN_REQUEST_POLICY_VERSION,
  FROZEN_REQUEST_PROMPT_TEMPLATE_VERSION,
  FROZEN_REQUEST_RULES,
  SUPPORTED_FROZEN_REQUEST_POLICY_VERSIONS,
  SUPPORTED_FROZEN_REQUEST_PROMPT_TEMPLATE_VERSIONS,
} from "../bridge/project-file-repository/request-draft.mjs";
import {
  fixture,
  html,
  importSource,
  json,
} from "./project-file-repository-harness.mjs";

function requestFor(summary, overrides = {}) {
  const target = { targetId: "target_test" };
  const comments = [{
    commentId: "comment_test",
    text: summary,
    target,
    attachments: [],
  }];
  const targets = [target];
  return {
    freezeCutoffRevision: 0,
    summary,
    comments,
    changeEvents: [],
    targets,
    taskSpec: compileTaskSpec({ comments, targets }),
    ...overrides,
  };
}

test("frozen policy v2 owns stable HTML editing rules and keeps v1 readable", () => {
  assert.equal(FROZEN_REQUEST_POLICY_VERSION, "2.0.0");
  assert.equal(FROZEN_REQUEST_PROMPT_TEMPLATE_VERSION, "2.0.0");
  assert.deepEqual([...SUPPORTED_FROZEN_REQUEST_POLICY_VERSIONS], ["1.0.0", "2.0.0"]);
  assert.deepEqual(
    [...SUPPORTED_FROZEN_REQUEST_PROMPT_TEMPLATE_VERSIONS],
    ["1.0.0", "2.0.0"],
  );
  assert.match(FROZEN_REQUEST_RULES, /AI_RULES\.md, explicit requirements in change-request\.json, PROJECT\.md/iu);
  assert.match(FROZEN_REQUEST_RULES, /changeEvents are audit context, not actions to replay, undo or apply again/iu);
  assert.match(FROZEN_REQUEST_RULES, /complete, parseable HTML document/iu);
  assert.match(FROZEN_REQUEST_RULES, /preserve the HTML unchanged instead of inventing work/iu);
  assert.match(FROZEN_REQUEST_RULES, /Never create, copy, normalize, transfer, duplicate or reuse an ID/iu);
  assert.match(FROZEN_REQUEST_RULES, /Modify authored source HTML, not the current Runtime DOM/iu);
  assert.match(FROZEN_REQUEST_RULES, /change its authored host, configuration or script/iu);
  assert.match(FROZEN_REQUEST_RULES, /targets-plus-required-dependencies allows only their minimal direct dependencies/iu);
  assert.match(FROZEN_REQUEST_RULES, /Do not add external dependencies, tracking, network calls/iu);
});

test("Request publication rechecks source bytes after freezing its input bundle", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "request-boundary.html");
  const externalHtml = html("external edit during request freeze");
  const repository = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      if (name === "request-input-manifest-written") {
        await writeFile(imported.target.exactSourcePath, externalHtml, "utf8");
      }
      return false;
    },
  });

  await assert.rejects(
    repository.prepareRequest({
      target: imported.target,
      requestId: "req_source_boundary",
      expectedSourceSha256: imported.target.sourceSha256,
      request: requestFor("Source boundary request."),
      prompt: "# Request\n",
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "SOURCE_HASH_CONFLICT",
  );

  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), externalHtml);
  const runtime = await json(path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "runtime-state.json",
  ));
  assert.equal(runtime.activeRequest, null);
  await assert.rejects(
    readFile(path.join(
      imported.target.projectRootPath,
      ".stemmio",
      "requests",
      "req_source_boundary",
      "request.json",
    )),
    (error) => error?.code === "ENOENT",
  );
});

test("request preparation fault injection restores one immutable active Request", async (t) => {
  for (const failpoint of [
    "request-attachments-written",
    "request-input-written",
    "request-project-rules-written",
    "request-annotations-written",
    "request-change-record-written",
    "request-prompt-written",
    "request-input-manifest-written",
    "request-record-written",
    "request-freeze-ready",
    "request-published",
    "request-runtime-written",
    "request-prepared",
  ]) {
    const value = await fixture(t);
    const imported = await importSource(value, "request-fault.html");
    const attachmentBytes = Buffer.from(`fault attachment ${failpoint}`, "utf8");
    const attachmentRelativePath = "draft/attachments/comment_fault/attachment_fault-attachment_fault.txt";
    const attachmentPath = path.join(
      imported.target.projectRootPath,
      ...attachmentRelativePath.split("/"),
    );
    await mkdir(path.dirname(attachmentPath), { recursive: true });
    await writeFile(attachmentPath, attachmentBytes);
    const request = {
      freezeCutoffRevision: 0,
      summary: `fault recovery ${failpoint}`,
      comments: [{
        commentId: "comment_fault",
        text: "附件故障恢复",
        target: { targetId: "target_fault" },
        attachments: [{
          attachmentId: "attachment_fault",
          kind: "file",
          fileName: "attachment_fault.txt",
          mediaType: "text/plain",
          byteLength: attachmentBytes.byteLength,
          sha256: sha256(attachmentBytes),
          relativePath: attachmentRelativePath,
        }],
      }],
      targets: [{ targetId: "target_fault" }],
    };
    request.taskSpec = compileTaskSpec({
      comments: request.comments,
      targets: request.targets,
      attachments: request.comments.flatMap((comment) => comment.attachments),
    });
    const prompt = `# ${failpoint}\n`;
    const failing = new ProjectFileRepository({
      projectsRoot: value.projects,
      failpoint: async (name) => name === failpoint,
    });
    await assert.rejects(
      failing.prepareRequest({
        target: imported.target,
        requestId: "req_fault_recovery",
        attemptId: "attempt_001",
        expectedSourceSha256: imported.target.sourceSha256,
        request,
        prompt,
      }),
      (error) => error instanceof ProjectFileRepositoryError
        && error.code === "INJECTED_FAILPOINT",
      failpoint,
    );
    const publicRequestPath = path.join(
      imported.target.projectRootPath,
      ".stemmio",
      "requests",
      "req_fault_recovery",
      "request.json",
    );
    const publishedBeforeRetry = new Set([
      "request-published",
      "request-runtime-written",
      "request-prepared",
    ]).has(failpoint);
    assert.equal(
      await lstat(publicRequestPath).then(() => true, () => false),
      publishedBeforeRetry,
      `${failpoint}: public request publication boundary`,
    );

    const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
    const prepared = await restarted.prepareRequest({
      target: imported.target,
      requestId: "req_fault_recovery",
      attemptId: "attempt_001",
      expectedSourceSha256: imported.target.sourceSha256,
      request,
      prompt,
    });
    assert.equal(prepared.status, "processing", failpoint);
    const workspace = await restarted.workspace({ sourcePath: imported.target.exactSourcePath });
    assert.equal(workspace.activeRequest.requestId, "req_fault_recovery", failpoint);
    assert.equal(workspace.activeRequest.status, "processing", failpoint);
    const requestRoots = (await readdir(path.join(
      imported.target.projectRootPath,
      ".stemmio",
      "requests",
    ), { withFileTypes: true })).filter((entry) => entry.isDirectory());
    assert.deepEqual(requestRoots.map((entry) => entry.name), ["req_fault_recovery"], failpoint);
    const frozenAttachmentPath = path.join(
      imported.target.projectRootPath,
      ".stemmio",
      "requests",
      "req_fault_recovery",
      "input",
      "attachments",
      "comment_fault",
      "attachment_fault-attachment_fault.txt",
    );
    assert.deepEqual(await readFile(frozenAttachmentPath), attachmentBytes, failpoint);
    await rm(attachmentPath);
    assert.deepEqual(await readFile(frozenAttachmentPath), attachmentBytes, failpoint);
    assert.equal(
      await lstat(path.join(
        imported.target.projectRootPath,
        ".stemmio",
        "recovery",
        "request-freeze",
        "req_fault_recovery",
      )).then(() => true, () => false),
      false,
      failpoint,
    );
    assert.equal(
      await lstat(path.join(
        imported.target.projectRootPath,
        ".stemmio",
        "recovery",
        "request-freeze",
        "req_fault_recovery.json",
      )).then(() => true, () => false),
      false,
      failpoint,
    );
  }
});

test("project recovery publishes a verified staged Request after a process-like interruption", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "request-published-recovery.html");
  const attachmentBytes = Buffer.from("recover this frozen attachment", "utf8");
  const attachmentRelativePath = "draft/attachments/comment_recovery/attachment_recovery-attachment_recovery.txt";
  const attachmentPath = path.join(
    imported.target.projectRootPath,
    ...attachmentRelativePath.split("/"),
  );
  await mkdir(path.dirname(attachmentPath), { recursive: true });
  await writeFile(attachmentPath, attachmentBytes);
  const requestId = "req_published_recovery";
  const request = {
    freezeCutoffRevision: 0,
    summary: "恢复已发布前的冻结 Request",
    comments: [{
      commentId: "comment_recovery",
      text: "",
      target: { targetId: "target_recovery" },
      attachments: [{
        attachmentId: "attachment_recovery",
        kind: "file",
        fileName: "attachment_recovery.txt",
        mediaType: "text/plain",
        byteLength: attachmentBytes.byteLength,
        sha256: sha256(attachmentBytes),
        relativePath: attachmentRelativePath,
      }],
    }],
    targets: [{ targetId: "target_recovery" }],
  };
  request.taskSpec = compileTaskSpec({
    comments: request.comments,
    targets: request.targets,
    attachments: request.comments.flatMap((comment) => comment.attachments),
  });
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => name === "request-published",
  });
  await assert.rejects(
    interrupted.prepareRequest({
      target: imported.target,
      requestId,
      attemptId: "attempt_001",
      expectedSourceSha256: imported.target.sourceSha256,
      request,
      prompt: "# interrupted freeze\n",
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );
  const controlRoot = path.join(imported.target.projectRootPath, ".stemmio");
  const stagingRoot = path.join(controlRoot, "recovery", "request-freeze", requestId);
  const markerPath = `${stagingRoot}.json`;
  const publishedRequestRoot = path.join(controlRoot, "requests", requestId);
  assert.equal(await lstat(stagingRoot).then(() => true, () => false), false);
  assert.equal(await lstat(publishedRequestRoot).then(() => true, () => false), true);
  assert.equal(await lstat(markerPath).then(() => true, () => false), true);
  assert.equal((await json(path.join(controlRoot, "runtime-state.json"))).activeRequest, null);

  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  const recovered = await restarted.recoverProject({
    projectRootPath: imported.target.projectRootPath,
  });
  assert.equal(
    recovered.some((item) => item.kind === "request-freeze" && item.state === "recovered"),
    true,
  );
  const runtime = await json(path.join(controlRoot, "runtime-state.json"));
  assert.equal(runtime.activeRequest?.requestId, requestId);
  const frozenPath = path.join(
    publishedRequestRoot,
    "input",
    "attachments",
    "comment_recovery",
    "attachment_recovery-attachment_recovery.txt",
  );
  assert.deepEqual(await readFile(frozenPath), attachmentBytes);
  assert.equal(await lstat(markerPath).then(() => true, () => false), false);
  await rm(attachmentPath);
  assert.deepEqual(await readFile(frozenPath), attachmentBytes);

  const markerlessRoot = path.join(
    controlRoot,
    "recovery",
    "request-freeze",
    "req_markerless_orphan",
  );
  await mkdir(path.join(markerlessRoot, "input"), { recursive: true });
  await writeFile(path.join(markerlessRoot, "input", "orphan.bin"), "orphan", "utf8");
  const orphanRecovery = await restarted.recoverProject({
    projectRootPath: imported.target.projectRootPath,
  });
  assert.equal(
    orphanRecovery.some((item) => item.requestId === "req_markerless_orphan"
      && item.state === "discarded-unpublished-staging"),
    true,
  );
  assert.equal(await lstat(markerlessRoot).then(() => true, () => false), false);
});

test("request recovery keeps the original runtime input-manifest anchor", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "runtime-anchor.html");
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_runtime_anchor",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: requestFor("runtime anchor"),
    prompt: "# Runtime anchor\n",
  });
  const controlRoot = path.join(imported.target.projectRootPath, ".stemmio");
  const runtimePath = path.join(controlRoot, "runtime-state.json");
  const requestPath = path.join(controlRoot, "requests", prepared.requestId, "request.json");
  const runtimeBefore = await json(runtimePath);
  const requestRecord = await json(requestPath);
  requestRecord.inputManifestSha256 = sha256(Buffer.from("untrusted manifest", "utf8"));
  await writeFile(requestPath, JSON.stringify(requestRecord), "utf8");

  await assert.rejects(
    value.repository.prepareRequest({
      target: imported.target,
      requestId: prepared.requestId,
      attemptId: prepared.attemptId,
      expectedSourceSha256: imported.target.sourceSha256,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "FROZEN_REQUEST_BUNDLE_MISMATCH",
  );
  const runtimeAfter = await json(runtimePath);
  assert.equal(
    runtimeAfter.activeRequest?.inputManifestSha256,
    runtimeBefore.activeRequest?.inputManifestSha256,
  );
});

test("request recovery binds Request identity to its sealed runtime anchor", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "runtime-identity-anchor.html");
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_runtime_identity_anchor",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: requestFor("runtime identity anchor"),
    prompt: "# Runtime identity anchor\n",
  });
  const controlRoot = path.join(imported.target.projectRootPath, ".stemmio");
  const runtimePath = path.join(controlRoot, "runtime-state.json");
  const requestPath = path.join(controlRoot, "requests", prepared.requestId, "request.json");
  const runtimeBefore = await json(runtimePath);
  const record = await json(requestPath);
  record.attemptId = "attempt_002";
  await writeFile(requestPath, JSON.stringify(record), "utf8");

  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
      sourcePath: imported.target.exactSourcePath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "REQUEST_IDENTITY_MISMATCH",
  );
  const runtimeAfter = await json(runtimePath);
  assert.equal(runtimeAfter.activeRequest?.requestId, runtimeBefore.activeRequest?.requestId);
  assert.equal(runtimeAfter.activeRequest?.attemptId, runtimeBefore.activeRequest?.attemptId);
});

test("request recovery never recreates runtime authority from Agent-owned Request files", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "agent-owned-request.html");
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_agent_owned_recovery",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: requestFor("must retain the runtime seal"),
    prompt: "# Runtime seal\n",
  });
  const controlRoot = path.join(imported.target.projectRootPath, ".stemmio");
  const runtimePath = path.join(controlRoot, "runtime-state.json");
  const requestPath = path.join(controlRoot, "requests", prepared.requestId, "request.json");
  const inputManifestPath = path.join(controlRoot, "requests", prepared.requestId, "input-manifest.json");
  const runtime = await json(runtimePath);
  runtime.activeRequest = null;
  runtime.activeCandidateId = null;
  await writeFile(runtimePath, JSON.stringify(runtime), "utf8");

  // An external Agent may alter every file it can see in its Request tree.
  // Its new digest must not become runtime authority when Stemmio reopens.
  const launderedManifest = Buffer.from('{"agent":"replacement bundle"}\n', "utf8");
  await writeFile(inputManifestPath, launderedManifest);
  const record = await json(requestPath);
  record.status = "processing";
  record.inputManifestSha256 = sha256(launderedManifest);
  await writeFile(requestPath, JSON.stringify(record), "utf8");

  const reopened = await new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(reopened.activeRequest, null);
  assert.equal(reopened.activeCandidate, null);
  const runtimeAfter = await json(runtimePath);
  assert.equal(runtimeAfter.activeRequest, null);
  assert.equal(runtimeAfter.activeCandidateId, null);
});

test("a Request freezes comments, targets and project rules alongside its exact HTML", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "frozen-request.html");
  const saved = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: html("persisted before request"),
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 1,
  });
  await value.repository.updateProjectNotes({
    target: saved.target,
    content: "# 项目规则\n\n只修改首页标题。\n",
  });
  const attachmentBuffer = Buffer.from("frozen comment attachment", "utf8");
  const attachmentPath = path.join(
    saved.target.projectRootPath,
    "draft",
    "attachments",
    "comment_001",
    "attachment_001-参考.png",
  );
  await mkdir(path.dirname(attachmentPath), { recursive: true });
  await writeFile(attachmentPath, attachmentBuffer);
  const comments = [{
    commentId: "comment_001",
    text: "把标题改成欢迎页",
    target: { targetId: "target_title" },
    attachments: [{
      attachmentId: "attachment_001",
      kind: "image",
      fileName: "参考.png",
      mediaType: "image/png",
      byteLength: attachmentBuffer.byteLength,
      sha256: sha256(attachmentBuffer),
      relativePath: "draft/attachments/comment_001/attachment_001-参考.png",
      source: "file-picker",
    }],
  }];
  const request = {
    freezeCutoffRevision: 1,
    summary: "按评论更新标题",
    comments,
    changeEvents: [{ eventId: "edit_001", kind: "text", target: { targetId: "target_title" } }],
    targets: [{ targetId: "target_title", selector: "h1" }],
    taskSpec: compileTaskSpec({
      comments,
      targets: [{ targetId: "target_title", selector: "h1" }],
      attachments: comments.flatMap((comment) => comment.attachments),
    }),
  };
  await assert.rejects(
    value.repository.prepareRequest({
      target: saved.target,
      requestId: "req_unknown_provider",
      attemptId: "attempt_001",
      expectedSourceSha256: saved.target.sourceSha256,
      request: {
        ...request,
        agentDelivery: {
          mode: "managed-agent",
          selection: {
            providerId: "future-agent",
            runtimeId: "future-runtime",
            requestedModelId: null,
            resolvedModelId: null,
            reasoning: { requested: null, applied: null, resolution: "provider-default" },
          },
          trustPolicyVersion: "trusted-local-agent-v1",
        },
      },
      prompt: "# must not publish\n",
    }),
    (error) => error?.code === "AGENT_DELIVERY_INVALID"
      && error?.details?.reasonCode === "AGENT_PROVIDER_UNSUPPORTED",
  );
  assert.equal(
    await lstat(path.join(
      saved.target.projectRootPath,
      ".stemmio",
      "requests",
      "req_unknown_provider",
    )).then(() => true, () => false),
    false,
  );
  const prepared = await value.repository.prepareRequest({
    target: saved.target,
    requestId: "req_frozen_inputs",
    attemptId: "attempt_001",
    expectedSourceSha256: saved.target.sourceSha256,
    request,
    prompt: "# 本轮任务\n",
  });
  const requestRoot = path.join(
    saved.target.projectRootPath,
    ".stemmio",
    "requests",
    prepared.requestId,
  );
  const annotationsPath = path.join(requestRoot, "input", "annotations", "records.json");
  const projectRulesPath = path.join(requestRoot, "input", "PROJECT.md");
  const changeRequestPath = path.join(requestRoot, "change-request.json");
  const inputManifestPath = path.join(requestRoot, "input-manifest.json");
  const frozenAnnotations = await readFile(annotationsPath);
  const frozenProjectRules = await readFile(projectRulesPath);
  const frozenChangeRequest = await readFile(changeRequestPath);
  const annotations = JSON.parse(frozenAnnotations.toString("utf8"));
  const changeRequest = JSON.parse(frozenChangeRequest.toString("utf8"));
  const inputManifest = await json(inputManifestPath);
  const requestAttachmentPath = "input/attachments/comment_001/attachment_001-参考.png";
  const frozenComments = [{
    ...comments[0],
    attachments: [{
      ...comments[0].attachments[0],
      requestRelativePath: requestAttachmentPath,
    }],
  }];
  const frozenAttachment = {
    ...comments[0].attachments[0],
    commentId: "comment_001",
    targetRef: "target_title",
    relativePath: "requests/req_frozen_inputs/" + requestAttachmentPath,
    requestRelativePath: requestAttachmentPath,
    localPath: path.join(
      requestRoot,
      ...requestAttachmentPath.split("/"),
    ),
  };
  assert.deepEqual(annotations.comments, frozenComments);
  assert.deepEqual(changeRequest.requirements, {
    taskSchemaVersion: "1.0.0",
    objective: "把标题改成欢迎页",
    scopePolicy: "targets-plus-required-dependencies",
    instructions: [{
      instructionId: "instruction_001",
      priority: "required",
      text: "把标题改成欢迎页",
      targetRefs: ["target_title"],
      acceptanceCriteria: [],
      attachmentRefs: ["attachment_001"],
    }],
    globalAcceptanceCriteria: [],
    nonGoals: [],
    targets: request.targets,
    attachments: [frozenAttachment],
  });
  assert.equal(changeRequest.policyVersion, "2.0.0");
  assert.equal(changeRequest.promptTemplateVersion, "2.0.0");
  assert.deepEqual(inputManifest.readOrder, [
    "PROMPT.md",
    "input/AI_RULES.md",
    "change-request.json",
    "input/PROJECT.md",
    "input/base/index.html",
    "input/annotations/records.json",
    requestAttachmentPath,
  ]);
  assert.deepEqual(
    inputManifest.files.find((entry) => entry.path === requestAttachmentPath),
    {
      path: requestAttachmentPath,
      role: "comment-attachment",
      mediaType: "image/png",
      byteLength: attachmentBuffer.byteLength,
      sha256: sha256(attachmentBuffer),
    },
  );
  assert.deepEqual(await readFile(path.join(requestRoot, requestAttachmentPath)), attachmentBuffer);
  assert.match(
    await readFile(path.join(requestRoot, "PROMPT.md"), "utf8"),
    new RegExp(`${requestAttachmentPath.replaceAll("/", "\\/")}`),
  );
  assert.equal(
    inputManifest.files.find((entry) => entry.path === "input/base/index.html").sha256,
    saved.target.sourceSha256,
  );
  assert.equal(prepared.inputManifestSha256, sha256(await readFile(inputManifestPath)));

  await value.repository.updateProjectNotes({
    target: saved.target,
    content: "# 已修改的项目规则\n",
  });
  await writeFile(attachmentPath, "draft attachment changed", "utf8");
  assert.deepEqual(await readFile(annotationsPath), frozenAnnotations);
  assert.deepEqual(await readFile(projectRulesPath), frozenProjectRules);
  assert.deepEqual(await readFile(changeRequestPath), frozenChangeRequest);
  assert.deepEqual(await readFile(path.join(requestRoot, requestAttachmentPath)), attachmentBuffer);
});

test("attachments-only comments freeze every byte before Request authority is published", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "attachments-only.html");
  const attachmentCases = [
    {
      commentId: "comment_alpha",
      attachmentId: "attachment_alpha",
      fileName: "alpha.txt",
      bytes: Buffer.from("alpha bytes", "utf8"),
      targetId: "target_alpha",
    },
    {
      commentId: "comment_beta",
      attachmentId: "attachment_beta",
      fileName: "beta.png",
      bytes: Buffer.from([0, 1, 2, 3, 254, 255]),
      targetId: "target_beta",
    },
  ];
  const comments = [];
  for (const item of attachmentCases) {
    const relativePath = `draft/attachments/${item.commentId}/${item.attachmentId}-${item.fileName}`;
    const sourcePath = path.join(imported.target.projectRootPath, ...relativePath.split("/"));
    await mkdir(path.dirname(sourcePath), { recursive: true });
    await writeFile(sourcePath, item.bytes);
    comments.push({
      commentId: item.commentId,
      text: "",
      target: { targetId: item.targetId },
      attachments: [{
        attachmentId: item.attachmentId,
        kind: item.fileName.endsWith(".png") ? "image" : "file",
        fileName: item.fileName,
        mediaType: item.fileName.endsWith(".png") ? "image/png" : "text/plain",
        byteLength: item.bytes.byteLength,
        sha256: sha256(item.bytes),
        relativePath,
      }],
    });
  }
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_attachments_only",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: {
      freezeCutoffRevision: 0,
      summary: "只根据附件完成修改",
      comments,
      targets: comments.map((comment) => comment.target),
      taskSpec: compileTaskSpec({
        comments,
        targets: comments.map((comment) => comment.target),
        attachments: comments.flatMap((comment) => comment.attachments),
      }),
    },
    prompt: "# 附件任务\n",
  });
  const requestRoot = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "requests",
    prepared.requestId,
  );
  const requestRecord = await json(path.join(requestRoot, "request.json"));
  const manifest = await json(path.join(requestRoot, "input-manifest.json"));
  const frozenAnnotations = await json(
    path.join(requestRoot, "input", "annotations", "records.json"),
  );
  assert.equal(requestRecord.request.comments.every((comment) => !comment.text), true);
  assert.equal(requestRecord.request.taskSpec.attachments.length, attachmentCases.length);
  assert.deepEqual(
    manifest.files.filter((entry) => entry.role === "comment-attachment").map((entry) => entry.path),
    [
      "input/attachments/comment_alpha/attachment_alpha-alpha.txt",
      "input/attachments/comment_beta/attachment_beta-beta.png",
    ],
  );
  for (const item of attachmentCases) {
    const requestRelativePath = `input/attachments/${item.commentId}/${item.attachmentId}-${item.fileName}`;
    const frozenPath = path.join(requestRoot, ...requestRelativePath.split("/"));
    assert.deepEqual(await readFile(frozenPath), item.bytes);
    const manifestEntry = manifest.files.find((entry) => entry.path === requestRelativePath);
    assert.deepEqual(manifestEntry, {
      path: requestRelativePath,
      role: "comment-attachment",
      mediaType: item.fileName.endsWith(".png") ? "image/png" : "text/plain",
      byteLength: item.bytes.byteLength,
      sha256: sha256(item.bytes),
    });
    const sourceInformation = await lstat(
      path.join(
        imported.target.projectRootPath,
        "draft",
        "attachments",
        item.commentId,
        `${item.attachmentId}-${item.fileName}`,
      ),
    );
    const frozenInformation = await lstat(frozenPath);
    assert.equal(sourceInformation.nlink, 1);
    assert.equal(frozenInformation.nlink, 1);
    assert.notEqual(frozenInformation.ino, sourceInformation.ino);
    const annotation = frozenAnnotations.comments.find(
      (comment) => comment.commentId === item.commentId,
    );
    assert.equal(annotation.attachments[0].requestRelativePath, requestRelativePath);
    await rm(
      path.join(
        imported.target.projectRootPath,
        "draft",
        "attachments",
        item.commentId,
        `${item.attachmentId}-${item.fileName}`,
      ),
    );
    assert.deepEqual(await readFile(frozenPath), item.bytes);
  }
  const prompt = await readFile(path.join(requestRoot, "PROMPT.md"), "utf8");
  assert.match(prompt, /attachmentRefs/iu);
  assert.match(prompt, /requestRelativePath/iu);
});

test("invalid comment attachments stop before request.json and Runtime authority", async (t) => {
  const cases = [
    { name: "missing", kind: "missing", expectedCode: "REQUEST_ATTACHMENT_NOT_FOUND" },
    { name: "hash mismatch", kind: "hash", expectedCode: "REQUEST_ATTACHMENT_HASH_MISMATCH" },
    { name: "byte length mismatch", kind: "length", expectedCode: "REQUEST_ATTACHMENT_LENGTH_MISMATCH" },
    { name: "metadata over limit", kind: "too-large", expectedCode: "REQUEST_ATTACHMENT_TOO_LARGE" },
    { name: "directory", kind: "directory", expectedCode: "UNSAFE_FILE" },
    { name: "symbolic link", kind: "symlink", expectedCode: "PATH_ESCAPES_PROJECT" },
    { name: "path traversal", kind: "traversal", expectedCode: "INVALID_RELATIVE_PATH" },
  ];
  for (const item of cases) {
    const value = await fixture(t);
    const imported = await importSource(value, `invalid-attachment-${item.kind}.html`);
    const commentId = "comment_invalid";
    const attachmentId = "attachment_invalid";
    const fileName = "payload.bin";
    const relativePath = `draft/attachments/${commentId}/${attachmentId}-${fileName}`;
    const sourcePath = path.join(imported.target.projectRootPath, ...relativePath.split("/"));
    const bytes = Buffer.from("actual attachment", "utf8");
    if (item.kind === "hash" || item.kind === "length") {
      await mkdir(path.dirname(sourcePath), { recursive: true });
      await writeFile(sourcePath, bytes);
    } else if (item.kind === "directory") {
      await mkdir(sourcePath, { recursive: true });
    } else if (item.kind === "symlink") {
      const external = path.join(value.root, "outside-attachment.bin");
      await writeFile(external, bytes);
      await mkdir(path.dirname(sourcePath), { recursive: true });
      await symlink(external, sourcePath);
    }
    const attachment = {
      attachmentId,
      kind: "file",
      fileName,
      mediaType: "application/octet-stream",
      byteLength: item.kind === "too-large" ? 25 * 1024 * 1024 + 1 : bytes.byteLength,
      sha256: item.kind === "hash" ? sha256(Buffer.from("other", "utf8")) : sha256(bytes),
      relativePath: item.kind === "traversal"
        ? `draft/attachments/${commentId}/../${attachmentId}-${fileName}`
        : relativePath,
    };
    if (item.kind === "length") attachment.byteLength += 1;
    const requestRoot = path.join(
      imported.target.projectRootPath,
      ".stemmio",
      "requests",
      `req_invalid_${item.kind}`,
    );
    await assert.rejects(
      value.repository.prepareRequest({
        target: imported.target,
        requestId: `req_invalid_${item.kind}`,
        attemptId: "attempt_001",
        expectedSourceSha256: imported.target.sourceSha256,
        request: {
          freezeCutoffRevision: 0,
          comments: [{
            commentId,
            text: "",
            target: { targetId: "target_invalid" },
            attachments: [attachment],
          }],
          targets: [{ targetId: "target_invalid" }],
          taskSpec: compileTaskSpec({
            comments: [{
              commentId,
              text: "",
              target: { targetId: "target_invalid" },
              attachments: [attachment],
            }],
            targets: [{ targetId: "target_invalid" }],
            attachments: [attachment],
          }),
        },
        prompt: "# invalid attachment\n",
      }),
      (error) => error instanceof ProjectFileRepositoryError
        && error.code === item.expectedCode,
      item.name,
    );
    await assert.rejects(
      readFile(path.join(requestRoot, "request.json")),
      (error) => error?.code === "ENOENT",
      item.name,
    );
    const runtime = await json(path.join(
      imported.target.projectRootPath,
      ".stemmio",
      "runtime-state.json",
    ));
    assert.equal(runtime.activeRequest, null, item.name);
    assert.equal(runtime.activeCandidateId, null, item.name);
  }
});

test("an existing unknown-provider Request remains readable and durably cancellable without read-time rewrite", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "unknown-provider-history.html");
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_unknown_history",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: requestFor("historical request", {
      agentDelivery: { mode: "clipboard" },
    }),
    prompt: "# historical request\n",
  });
  const requestPath = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "requests",
    prepared.requestId,
    "request.json",
  );
  const record = JSON.parse(await readFile(requestPath, "utf8"));
  record.request.agentDelivery = {
    mode: "managed-agent",
    selection: {
      providerId: "future-agent",
      runtimeId: "future-runtime",
      requestedModelId: "future-agent:model-a",
      resolvedModelId: "future-agent:model-a",
      reasoning: { requested: "high", applied: "high", resolution: "exact" },
    },
    trustPolicyVersion: "trusted-local-agent-v1",
  };
  await writeFile(requestPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  const historicalBytes = await readFile(requestPath, "utf8");

  const status = await value.repository.requestStatus({
    target: imported.target,
    requestId: prepared.requestId,
    attemptId: prepared.attemptId,
  });
  assert.equal(status.request.request.agentDelivery.selection.providerId, "future-agent");
  assert.equal(await readFile(requestPath, "utf8"), historicalBytes);

  const cancelled = await value.repository.cancelRequest({
    target: imported.target,
    requestId: prepared.requestId,
    attemptId: prepared.attemptId,
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal(JSON.parse(await readFile(requestPath, "utf8")).status, "cancelled");
});

test("injected provider authority can normalize a new selection without a legacy driver", async (t) => {
  const value = await fixture(t);
  const repository = new ProjectFileRepository({
    projectsRoot: value.projects,
    agentDeliveryNormalizer: (input) => {
      const delivery = normalizeAgentDelivery(input, { allowLegacy: false });
      if (delivery.mode === "managed-agent"
        && (delivery.selection.providerId !== "synthetic-provider"
          || delivery.selection.runtimeId !== "synthetic-runtime")) {
        throw Object.assign(new Error("unsupported provider"), {
          code: "AGENT_PROVIDER_UNSUPPORTED",
        });
      }
      return delivery;
    },
  });
  const imported = await importSource({ ...value, repository }, "selection-first-request.html");
  const agentDelivery = {
    mode: "managed-agent",
    selection: {
      providerId: "synthetic-provider",
      runtimeId: "synthetic-runtime",
      requestedModelId: null,
      resolvedModelId: null,
      reasoning: { requested: null, applied: null, resolution: "provider-default" },
    },
    trustPolicyVersion: "trusted-local-agent-v1",
  };
  const prepared = await repository.prepareRequest({
    target: imported.target,
    requestId: "req_selection_first_provider",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: requestFor("selection-first request", { agentDelivery }),
    prompt: "# selection-first request\n",
  });
  assert.deepEqual(prepared.request.agentDelivery, normalizeAgentDelivery(agentDelivery));
});

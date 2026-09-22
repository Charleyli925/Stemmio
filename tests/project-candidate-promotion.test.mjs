import assert from "node:assert/strict";
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import { inspectSourceElementIdentity } from "../bridge/project-file-repository/working-copy.mjs";
import { compileTaskSpec } from "../shared/task-spec.mjs";
import {
  ProjectFileRepository,
  ProjectFileRepositoryError,
} from "../bridge/project-file-repository.mjs";
import {
  fixture,
  html,
  importSource,
  json,
} from "./project-file-repository-harness.mjs";

for (const sameContent of [false, true]) {
test(`Candidate rejection consumes no ordinal and promotion is idempotent (same content: ${sameContent})`, async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const firstCandidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_rejected",
    candidateId: "candidate_rejected_0001",
    html: sameContent ? await readFile(imported.target.exactSourcePath, "utf8") : html("rejected candidate"),
    expectedSourceSha256: imported.target.sourceSha256,
  });

  assert.equal(firstCandidate.candidate.status, "pending-review");
  assert.equal(firstCandidate.candidate.proposedVersionId, "ver_0002");
  assert.ok(["ready", "attention"].includes(firstCandidate.candidate.assessment.status));
  let manifest = await json(path.join(imported.target.projectRootPath, ".stemmio", "manifest.json"));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
  assert.equal(manifest.latestOfficialVersionId, "ver_0001");

  const rejected = await value.repository.rejectCandidate({
    target: imported.target,
    candidateId: firstCandidate.candidate.candidateId,
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.latestOfficialVersionId, "ver_0001");

  const secondCandidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_adopted",
    candidateId: "candidate_adopted_0001",
    html: sameContent ? await readFile(imported.target.exactSourcePath, "utf8") : html("adopted candidate"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  assert.equal(secondCandidate.candidate.proposedVersionId, "ver_0002");

  const promoted = await value.repository.promoteCandidate({
    target: imported.target,
    candidateId: secondCandidate.candidate.candidateId,
    decisionOperationId: `promote_${secondCandidate.candidate.candidateId}`,
  });
  assert.equal(promoted.promoted, true);
  assert.equal(promoted.version.versionId, "ver_0002");
  assert.equal(promoted.target.workingCopyId, imported.target.workingCopyId);

  const repeated = await value.repository.promoteCandidate({
    target: imported.target,
    candidateId: secondCandidate.candidate.candidateId,
    decisionOperationId: `promote_${secondCandidate.candidate.candidateId}`,
  });
  assert.equal(repeated.version.versionId, "ver_0002");
  manifest = await json(path.join(imported.target.projectRootPath, ".stemmio", "manifest.json"));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001", "ver_0002"]);
  assert.equal(manifest.latestOfficialVersionId, "ver_0002");
});
}

test("Candidate adoption requires its own decision receipt and retries one lost response", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "candidate-receipt.html");
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_candidate_receipt",
    candidateId: "candidate_candidate_receipt_0001",
    html: html("candidate receipt"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  await assert.rejects(
    value.repository.promoteCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
    }),
    { code: "DECISION_IDENTITY_MISMATCH" },
  );
  await assert.rejects(
    value.repository.promoteCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
      decisionOperationId: "promote_candidate_other_0001",
    }),
    { code: "DECISION_IDENTITY_MISMATCH" },
  );
  let lostResponse = true;
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      if (name === "current-version-manifest-written" && lostResponse) {
        lostResponse = false;
        return true;
      }
      return false;
    },
  });
  const input = {
    target: imported.target,
    candidateId: candidate.candidate.candidateId,
    decisionOperationId: `promote_${candidate.candidate.candidateId}`,
  };
  await assert.rejects(
    interrupted.promoteCandidate(input),
    { code: "INJECTED_FAILPOINT" },
  );
  const afterLostResponse = await json(path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "manifest.json",
  ));
  assert.deepEqual(afterLostResponse.versions.map((version) => version.versionId), ["ver_0001", "ver_0002"]);
  const recovered = await new ProjectFileRepository({ projectsRoot: value.projects }).promoteCandidate(input);
  assert.equal(recovered.version.versionId, "ver_0002");
  const replayed = await new ProjectFileRepository({ projectsRoot: value.projects }).promoteCandidate(input);
  assert.equal(replayed.version.versionId, "ver_0002");
  const finalManifest = await json(path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "manifest.json",
  ));
  assert.deepEqual(finalManifest.versions.map((version) => version.versionId), ["ver_0001", "ver_0002"]);
});

test("promotion preserves the identity-normalized Candidate in its Version and Working Copy", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "promotion-identity.html");
  const candidateSubmission = html("Candidate").replace(
    /<h1 data-stemmio-id="[^"]+">Candidate<\/h1>/u,
    "<main>Candidate</main>",
  );
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_promotion_identity",
    candidateId: "candidate_promotion_identity_0001",
    html: candidateSubmission,
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const promoted = await value.repository.promoteCandidate({
    target: imported.target,
    candidateId: candidate.candidate.candidateId,
    decisionOperationId: `promote_${candidate.candidate.candidateId}`,
  });
  const controlRoot = path.join(imported.target.projectRootPath, ".stemmio");
  const candidateHtml = await readFile(path.join(
    controlRoot,
    "requests",
    "req_promotion_identity",
    "candidate.html",
  ), "utf8");
  assert.notEqual(candidateHtml, candidateSubmission);
  assert.equal(inspectSourceElementIdentity(candidateHtml).complete, true);
  assert.equal(
    await readFile(path.join(controlRoot, "versions", "ver_0002", "index.html"), "utf8"),
    candidateHtml,
  );
  const managedHtml = await readFile(promoted.target.exactSourcePath, "utf8");
  assert.equal(managedHtml, candidateHtml);
  assert.equal(inspectSourceElementIdentity(managedHtml).complete, true);
  assert.equal(promoted.target.sourceSha256, sha256(Buffer.from(managedHtml, "utf8")));
  const state = await json(path.join(controlRoot, "working-copies", imported.target.workingCopyId + ".json"));
  assert.equal(state.baseSha256, candidate.candidate.outputSha256);
  assert.equal(state.currentSha256, promoted.target.sourceSha256);
  assert.equal(state.differsFromBase, false);
  assert.equal(state.sourceElementIdentitySchemaVersion, 1);
  const transaction = await json(path.join(
    controlRoot,
    "transactions",
    `current_promote_${candidate.candidate.candidateId}`,
    "transaction.json",
  ));
  assert.equal(transaction.version.contentSha256, candidate.candidate.outputSha256);
  assert.equal(transaction.afterSha256, promoted.target.sourceSha256);
});

test("historical editing replaces the one current draft and preserves its replaced content", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  let current = imported.target;
  for (let ordinal = 2; ordinal <= 6; ordinal += 1) {
    const candidate = await value.repository.createCandidate({ target: current, requestId: `req_history_${ordinal}`,
      candidateId: `candidate_history_${ordinal}_0001`, html: html(`V${ordinal}`), expectedSourceSha256: current.sourceSha256 });
    current = (await value.repository.promoteCandidate({ target: current, candidateId: candidate.candidate.candidateId,
      decisionOperationId: `promote_${candidate.candidate.candidateId}` })).target;
  }
  const old = await value.repository.readVersionFile({ target: current, versionId: "ver_0002" });
  const created = await value.repository.createVersionFromHistory({ target: current, versionId: "ver_0002",
    operationId: "current_history_v7", expectedSourceSha256: current.sourceSha256, expectedSnapshotSha256: old.sha256 });
  assert.equal(created.versionId, "ver_0007");
  assert.equal(created.workingCopyId, imported.target.workingCopyId);
  assert.equal(created.sourcePath, imported.target.exactSourcePath);
  assert.equal(await readFile(created.sourcePath, "utf8"), html("V2"));
  assert.equal((await value.repository.readVersionFile({ target: current, versionId: "ver_0002" })).sha256, old.sha256);
  const records = await value.repository.listPreservedDrafts({ projectId: current.projectId });
  assert.ok(records.some((entry) => entry.sourceSha256 === sha256(Buffer.from(html("V6")))));
});

test("blocked Candidate validation never reserves a Version", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  await assert.rejects(
    value.repository.createCandidate({
      target: imported.target,
      requestId: "req_empty_candidate",
      candidateId: "candidate_empty_0001",
      html: html("empty").replace(/<h1[^>]*>empty<\/h1>/u, ""),
      expectedSourceSha256: imported.target.sourceSha256,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_UNUSABLE",
  );
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "manifest.json",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
});

test("createCandidate flags authored script changes and keeps weak continuity as review", async (t) => {
  const value = await fixture(t);
  const base = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Scope fixture</title>
  <script id="shared-script">window.scopeFixture = 1;</script>
</head>
<body>
  <main id="target"><p id="inside">目标正文</p></main>
  <aside id="outside">目标外正文</aside>
</body>
</html>`;
  const imported = await importSource(value, "scope.html", base);
  const identityBase = await readFile(imported.target.exactSourcePath, "utf8");

  const scriptOnly = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_script_only",
    candidateId: "candidate_script_only_0001",
    html: identityBase.replace("window.scopeFixture = 1", "window.scopeFixture = 2"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  assert.equal(scriptOnly.candidate.status, "pending-review");
  assert.equal(scriptOnly.candidate.assessment.status, "attention");
  assert.deepEqual(scriptOnly.candidate.assessment.issueCodes, ["AUTHORED_SCRIPT_CHANGED"]);
  assert.equal("executable" in scriptOnly.candidate.assessment, false);
  assert.equal(
    "executableSurfaceUnchanged" in scriptOnly.candidate.assessment.health,
    false,
  );
  assert.equal(scriptOnly.candidate.proposedVersionId, "ver_0002");

  await value.repository.rejectCandidate({
    target: imported.target,
    candidateId: scriptOnly.candidate.candidateId,
  });

  const unrelated = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_unrelated_page",
    candidateId: "candidate_unrelated_0001",
    html: identityBase
      .replace(">Scope fixture</title>", ">另一页</title>")
      .replace(
        /<body([^>]*)>[\s\S]*<\/body>/u,
        '<body$1><article>全新的内容与结构</article></body>',
      ),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  assert.equal(unrelated.candidate.status, "pending-review");
  assert.equal(unrelated.candidate.assessment.status, "attention");
  assert.deepEqual(
    unrelated.candidate.assessment.issueCodes,
    ["PAGE_CONTINUITY_UNCERTAIN"],
  );
  assert.equal(unrelated.candidate.proposedVersionId, "ver_0002");
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "manifest.json",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
});

test("runtime authority seals Candidate record and output after review begins", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_candidate_authority",
    candidateId: "candidate_authority_0001",
    html: html("reviewed candidate"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const requestRoot = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "requests",
    "req_candidate_authority",
  );
  const runtimePath = path.join(imported.target.projectRootPath, ".stemmio", "runtime-state.json");
  const runtimeBefore = await json(runtimePath);
  const rewrittenHtml = html("unreviewed replacement");
  const rewrittenRecord = await json(path.join(requestRoot, "candidate.json"));
  rewrittenRecord.outputSha256 = sha256(Buffer.from(rewrittenHtml, "utf8"));
  await writeFile(path.join(requestRoot, "candidate.html"), rewrittenHtml, "utf8");
  await writeFile(path.join(requestRoot, "candidate.json"), JSON.stringify(rewrittenRecord), "utf8");

  await assert.rejects(
    value.repository.readCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_AUTHORITY_MISMATCH",
  );
  await assert.rejects(
    value.repository.promoteCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
      decisionOperationId: `promote_${candidate.candidate.candidateId}`,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_AUTHORITY_MISMATCH",
  );

  const runtimeAfter = await json(runtimePath);
  assert.equal(
    runtimeAfter.activeRequest.candidateOutputSha256,
    runtimeBefore.activeRequest.candidateOutputSha256,
  );
  assert.equal(
    runtimeAfter.activeRequest.candidateRecordSha256,
    runtimeBefore.activeRequest.candidateRecordSha256,
  );
});

for (const sameContent of [false, true]) {
test(`prepared Candidate recovery retains runtime authority (same content: ${sameContent})`, async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const comments = [{
    commentId: "comment_candidate_recovery",
    text: "recover sealed candidate",
    target: { targetId: "target_candidate_recovery" },
    attachments: [],
  }];
  const targets = [{ targetId: "target_candidate_recovery" }];
  const request = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_candidate_recovery",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: {
      summary: "recover sealed candidate",
      comments,
      targets,
      taskSpec: compileTaskSpec({ comments, targets }),
    },
    prompt: "# recover sealed candidate\n",
  });
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => name === "candidate-prepared",
  });
  await assert.rejects(
    interrupted.completeRequest({
      target: imported.target,
      requestId: request.requestId,
      attemptId: request.attemptId,
      html: sameContent ? await readFile(imported.target.exactSourcePath, "utf8") : html("candidate after interrupted completion"),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );

  const recovered = await new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(recovered.activeRequest.status, "candidate-ready");
  assert.equal(recovered.activeCandidate.candidateId, request.candidateId);
});
}

test("a Candidate cannot be adopted after its frozen Working Copy changes", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_stale_candidate",
    candidateId: "candidate_stale_0001",
    html: html("candidate from V1"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const edited = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: html("working copy changed after review"),
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 1,
  });

  await assert.rejects(
    value.repository.promoteCandidate({
      target: edited.target,
      candidateId: candidate.candidate.candidateId,
      decisionOperationId: `promote_${candidate.candidate.candidateId}`,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_SOURCE_CHANGED",
  );
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "manifest.json",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
  const persistedCandidate = await json(path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "requests",
    "req_stale_candidate",
    "candidate.json",
  ));
  assert.equal(persistedCandidate.status, "pending-review");
});

test("request finalization creates a reviewable Candidate only, and manifest path traversal is refused", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const comments = [{
    commentId: "comment_candidate_lifecycle",
    text: "candidate lifecycle",
    target: { targetId: "target_candidate_lifecycle" },
    attachments: [],
  }];
  const targets = [{ targetId: "target_candidate_lifecycle" }];
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_workflow",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: {
      summary: "candidate lifecycle",
      comments,
      targets,
      taskSpec: compileTaskSpec({ comments, targets }),
    },
    prompt: "# Frozen candidate request\n",
  });
  assert.equal(prepared.status, "processing");
  assert.equal(prepared.proposedVersionId, "ver_0002");
  const completed = await value.repository.completeRequest({
    target: imported.target,
    requestId: prepared.requestId,
    attemptId: prepared.attemptId,
    html: html("request candidate"),
  });
  assert.equal(completed.status, "candidate-ready");
  assert.equal(completed.candidate.status, "pending-review");
  const beforeAdoption = await json(path.join(imported.target.projectRootPath, ".stemmio", "manifest.json"));
  assert.equal(beforeAdoption.latestOfficialVersionId, "ver_0001");
  assert.equal(beforeAdoption.versions.length, 1);

  const manifestPath = path.join(imported.target.projectRootPath, ".stemmio", "manifest.json");
  const tampered = await json(manifestPath);
  tampered.workingCopies[0].sourceRelativePath = "../escape.html";
  await writeFile(manifestPath, JSON.stringify(tampered), "utf8");
  await assert.rejects(
    value.repository.resolveOpenTarget({ sourcePath: imported.target.exactSourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && (error.code === "INVALID_RELATIVE_PATH" || error.code === "PATH_ESCAPES_PROJECT"),
  );
});

test("request finalization seals Candidate impact against its requested Stable ID targets", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "candidate-impact.html", html("V1"));
  const baseHtml = await readFile(imported.target.exactSourcePath, "utf8");
  const identity = inspectSourceElementIdentity(baseHtml);
  const targetId = identity.elements.find((element) => element.tagName === "h1")?.stemmioId;
  const outsideId = identity.elements.find((element) => element.tagName === "title")?.stemmioId;
  assert.ok(targetId);
  assert.ok(outsideId);
  const comments = [{
    commentId: "comment_h1",
    text: "只修改标题。",
    target: { targetId: "target_h1" },
    attachments: [],
  }];
  const targets = [{
    targetId: "target_h1",
    elementId: targetId,
    label: "页面标题",
    level: "module",
    selector: "h1",
    resolution: "exact",
  }];
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_candidate_impact",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: {
      summary: "验证评论目标之外的修改提示",
      comments,
      changeEvents: [],
      targets,
      taskSpec: compileTaskSpec({ comments, targets }),
    },
    prompt: "# Candidate impact\n",
  });
  const candidateHtml = baseHtml
    .replace(">V1</title>", ">V1 页面标题</title>")
    .replace(">V1</h1>", ">V1 页面标题</h1>");
  const completed = await value.repository.completeRequest({
    target: imported.target,
    requestId: prepared.requestId,
    attemptId: prepared.attemptId,
    html: candidateHtml,
  });
  assert.equal(completed.status, "candidate-ready");
  assert.equal(completed.candidate.assessment.requestedTargetCount, 1);
  assert.deepEqual(completed.candidate.assessment.changedElementIdSample, [targetId, outsideId].sort());
  assert.equal(completed.candidate.assessment.outsideTargetCount, 1);
  assert.deepEqual(completed.candidate.assessment.outsideTargetElementIdSample, [outsideId]);
  assert.equal(completed.candidate.assessment.truncated, false);
  const reread = await value.repository.readCandidate({
    target: imported.target,
    candidateId: completed.candidate.candidateId,
  });
  assert.deepEqual(
    reread.candidate.assessment.outsideTargetElementIdSample,
    [outsideId],
  );
});

test("request finalization treats a comment root and its descendants as one allowed impact scope", async (t) => {
  const value = await fixture(t);
  const ids = {
    html: "sm1_11111111111141118111111111111111",
    head: "sm1_22222222222242229222222222222222",
    title: "sm1_3333333333334333a333333333333333",
    body: "sm1_4444444444444444b444444444444444",
    section: "sm1_77777777777747778077777777777777",
    heading: "sm1_88888888888848888088888888888888",
    paragraph: "sm1_99999999999949999099999999999999",
    outside: "sm1_aaaaaaaabbbb4ccc8ddddeeeeeeeeeee",
  };
  const baseHtml = `<!doctype html><html data-stemmio-id="${ids.html}"><head data-stemmio-id="${ids.head}"><title data-stemmio-id="${ids.title}">Scope</title></head><body data-stemmio-id="${ids.body}"><section data-stemmio-id="${ids.section}"><h2 data-stemmio-id="${ids.heading}">标题</h2><p data-stemmio-id="${ids.paragraph}">正文</p></section><aside data-stemmio-id="${ids.outside}">旁支</aside></body></html>`;
  const imported = await importSource(value, "comment-root-scope.html", baseHtml);
  const comments = [{
    commentId: "comment_section",
    text: "调整 Section 内的标题和正文",
    target: {
      targetId: "target_section",
      elementId: ids.section,
      level: "module",
      selector: "section",
      resolution: "exact",
    },
    attachments: [],
  }];
  const targets = [{
    targetId: "target_section",
    elementId: ids.section,
    level: "module",
    selector: "section",
    resolution: "exact",
  }];
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_comment_root_scope",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: {
      freezeCutoffRevision: 0,
      summary: "评论整个 Section",
      comments,
      targets,
      taskSpec: compileTaskSpec({ comments, targets }),
    },
    prompt: "# Section scope\n",
  });
  const candidate = await value.repository.completeRequest({
    target: imported.target,
    requestId: prepared.requestId,
    attemptId: prepared.attemptId,
    html: baseHtml
      .replace(">标题</h2>", ">更新标题</h2>")
      .replace(">正文</p>", ">更新正文</p>"),
  });
  assert.equal(candidate.status, "candidate-ready");
  assert.equal(candidate.candidate.assessment.requestedTargetCount, 1);
  assert.deepEqual(
    candidate.candidate.assessment.changedElementIdSample,
    [ids.heading, ids.paragraph].sort(),
  );
  assert.equal(candidate.candidate.assessment.outsideTargetCount, 0);
});

import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import path from "node:path";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";
import { readFile, writeFile, rename, unlink } from "node:fs/promises";
import { fixture, html, importSource, promoteNextVersion } from "./project-file-repository-harness.mjs";

test("history creation allocates V9 from V3 and replays the same operation", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  let target = imported.target;
  for (let ordinal = 2; ordinal <= 8; ordinal += 1) target = await promoteNextVersion(value.repository, target, `Version${ordinal}`);
  const before = await readFile(target.exactSourcePath, "utf8");
  const request = { target, versionId: "ver_0003", operationId: "history_create_0001", expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: sha256(Buffer.from(html("Version3"))) };
  const result = await value.repository.createVersionFromHistory(request);
  assert.equal(result.status, "created");
  assert.equal(result.versionId, "ver_0009");
  assert.equal(result.basedOnVersionId, "ver_0003");
  assert.equal(result.previousVersionId, "ver_0008");
  assert.match(await readFile(result.sourcePath, "utf8"), /Version3/);
  assert.equal(result.sourcePath, target.exactSourcePath);
  assert.ok((await value.repository.listPreservedDrafts({ projectId: target.projectId })).some((entry) => entry.sourceSha256 === sha256(Buffer.from(before))));
  assert.deepEqual(await value.repository.createVersionFromHistory(request), result);
  assert.deepEqual(await value.repository.queryHistoryCreation({ target, operationId: request.operationId }), result);
  const workspace = await value.repository.workspace({ sourcePath: result.sourcePath });
  assert.equal(workspace.manifest.versions.length, 9);
  assert.equal(workspace.runtime.activeWorkingCopyId, target.workingCopyId);
  assert.equal(workspace.manifest.workingCopies.length, 1);
  assert.equal(workspace.manifest.versions.at(-1).sourceType, "history-copy");
});

for (const stage of ["prepared", "snapshot-written", "source-written", "manifest-written", "completed"]) {
  test(`history creation recovers after ${stage} without duplicating the Version`, async (t) => {
    const value = await fixture(t);
    const { target } = await importSource(value);
    await value.repository.saveDraft({ target, operationId: "draftop_history_preserved", expectedDraftRevision: 0,
      comments: [{ commentId: "comment_preserve", text: "keep original task" }], changeEvents: [], deletedCommentIds: [] });
    const draftPath = path.join(target.projectRootPath, ".stemmio/drafts/work_ver_0001.json");
    const draftBefore = await readFile(draftPath, "utf8");
    const rulesBefore = await readFile(path.join(target.projectRootPath, "PROJECT.md"), "utf8");
    const repository = new ProjectFileRepository({ projectsRoot: value.projects, failpoint: (name) => name === `current-version-${stage}` });
    const request = { target, versionId: "ver_0001", operationId: "history_recover_0001", expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: target.sourceSha256 };
    await assert.rejects(repository.createVersionFromHistory(request), { code: "INJECTED_FAILPOINT" });
    const recovered = new ProjectFileRepository({ projectsRoot: value.projects });
    await recovered.recoverProject({ projectRootPath: target.projectRootPath });
    const result = await recovered.queryHistoryCreation({ target, operationId: request.operationId });
    assert.equal(result.status, "created");
    assert.equal(result.versionId, "ver_0002");
    assert.deepEqual(await recovered.createVersionFromHistory(request), result);
    const workspace = await recovered.workspace({ sourcePath: result.sourcePath });
    assert.equal(workspace.manifest.versions.length, 2);
    assert.deepEqual(workspace.draft.comments, []);
    const preserved = await recovered.listPreservedDrafts({ projectId: target.projectId });
    const record = await recovered.readPreservedDraft({ projectId: target.projectId, recoveryId: preserved[0].recoveryId });
    assert.deepEqual(record.draft, JSON.parse(draftBefore));
    assert.equal(await readFile(path.join(target.projectRootPath, "PROJECT.md"), "utf8"), rulesBefore);
    const opened = await recovered.queryHistoryCreation({ target, operationId: request.operationId, markOpened: true });
    assert.ok(opened.openedAt);
    assert.equal((await recovered.queryHistoryCreation({ target, operationId: request.operationId })).openedAt, opened.openedAt);
  });
}

test("two repository instances replay one creation without allocating another current file", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value);
  const first = new ProjectFileRepository({ projectsRoot: value.projects });
  const second = new ProjectFileRepository({ projectsRoot: value.projects });
  const request = { target, versionId: "ver_0001", operationId: "history_concurrent_0001", expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: target.sourceSha256 };
  const [a, b] = await Promise.all([first.createVersionFromHistory(request), second.createVersionFromHistory(request)]);
  assert.deepEqual(a, b);
  assert.equal(a.sourcePath, target.exactSourcePath);
  assert.equal((await first.workspace({ sourcePath: a.sourcePath })).manifest.workingCopies.length, 1);
});

test("creation refuses changed snapshots, changed current bytes and pending Candidates", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value);
  const request = { target, versionId: "ver_0001", operationId: "history_reject_0001", expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: target.sourceSha256 };
  await assert.rejects(value.repository.createVersionFromHistory({ ...request, expectedSnapshotSha256: `sha256:${"a".repeat(64)}` }), { code: "VERSION_SNAPSHOT_HASH_MISMATCH" });
  assert.equal((await value.repository.queryHistoryCreation({ target, operationId: request.operationId })).status, "not-created");
  await assert.rejects(value.repository.createVersionFromHistory({ ...request, expectedSourceSha256: `sha256:${"b".repeat(64)}` }), { code: "HISTORY_CREATION_SOURCE_CHANGED" });
  await value.repository.createCandidate({ target, candidateId: "candidate_history_pending_0001", requestId: "req_history_pending_0001", html: html("candidate"), expectedSourceSha256: target.sourceSha256 });
  await assert.rejects(value.repository.createVersionFromHistory(request), { code: "HISTORY_CREATION_RUN_LOCKED" });
});

test("a replayed operation cannot change its source and a query cannot cross project identity", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value);
  const request = { target, versionId: "ver_0001", operationId: "history_identity_0001", expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: target.sourceSha256 };
  const result = await value.repository.createVersionFromHistory(request);
  await assert.rejects(value.repository.createVersionFromHistory({ ...request, versionId: "ver_0002" }), { code: "HISTORY_CREATION_OPERATION_MISMATCH" });
  const b = await importSource(value, "second.html", html("B"));
  const other = await value.repository.queryHistoryCreation({ target: b.target, operationId: request.operationId });
  assert.equal(other.status, "not-created");
  assert.equal(other.projectId, b.target.projectId);
  await writeFile(result.sourcePath, html("edited after creation"));
  assert.equal((await value.repository.queryHistoryCreation({ target, operationId: request.operationId })).versionId, result.versionId);
});

test("a changed source before manifest commit aborts without overwriting user files and does not block restart", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value);
  const repository = new ProjectFileRepository({ projectsRoot: value.projects, failpoint: async (name) => {
    if (name === "current-version-state-written") await writeFile(target.exactSourcePath, html("external current"));
    return false;
  } });
  const request = { target, versionId: "ver_0001", operationId: "history_abort_0001", expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: target.sourceSha256 };
  await assert.rejects(repository.createVersionFromHistory(request), { code: "WORKING_COPY_CONFLICT" });
  assert.equal((await repository.queryHistoryCreation({ target, operationId: request.operationId })).status, "not-created");
  assert.equal(await readFile(target.exactSourcePath, "utf8"), html("external current"));
  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  await restarted.recoverProject({ projectRootPath: target.projectRootPath });
  assert.equal((await restarted.queryHistoryCreation({ target, operationId: request.operationId })).status, "not-created");
  await writeFile(target.exactSourcePath, html("V1"));
  const next = await restarted.createVersionFromHistory({ ...request, operationId: "history_after_abort_0001" });
  assert.equal(next.versionId, "ver_0002");
  await restarted.recoverProject({ projectRootPath: target.projectRootPath });
  assert.equal((await restarted.workspace({ sourcePath: next.sourcePath })).manifest.versions.length, 2);
});

test("completed creation survives registered rename and reports supersession without changing its fact", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value);
  const operationId = "history_rename_0001";
  const created = await value.repository.createVersionFromHistory({ target, versionId: "ver_0001", operationId,
    expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: target.sourceSha256 });
  await value.repository.workspace({ sourcePath: created.sourcePath });
  await value.repository.queryHistoryCreation({ target, operationId, markOpened: true });
  const renamedPath = path.join(target.projectRootPath, "renamed-created.html");
  await rename(created.sourcePath, renamedPath);
  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  const workspace = await restarted.workspace({ sourcePath: renamedPath });
  const receipt = await restarted.queryHistoryCreation({ target: workspace.target, operationId });
  assert.equal(receipt.status, "created");
  assert.equal(receipt.versionId, created.versionId);
  assert.equal(receipt.sourcePath, renamedPath);
  assert.equal(receipt.recoveryState, "opened");
  const next = await promoteNextVersion(restarted, workspace.target, "after_history_rename");
  const older = await new ProjectFileRepository({ projectsRoot: value.projects }).queryHistoryCreation({ target: next, operationId });
  assert.equal(older.recoveryState, "superseded");
  assert.equal(older.versionId, created.versionId);
});

for (const stage of ["prepared", "source-written"]) {
  for (const replace of [false, true]) {
    test(`current history recovery ${stage}: ${replace ? "same-byte replacement" : "observation drift"}`, async (t) => {
      const value = await fixture(t);
      const { target } = await importSource(value);
      await value.repository.saveWorkingCopy({ target, html: html("local"), expectedSourceSha256: target.sourceSha256 });
      const active = (await value.repository.resolveRegisteredProjectOpenTarget({ projectId: target.projectId })).target;
      const operationId = "history_identity_recovery_0001";
      const repository = new ProjectFileRepository({ projectsRoot: value.projects, failpoint: (name) => name === `current-version-${stage}` });
      await assert.rejects(repository.createVersionFromHistory({ target: active, versionId: "ver_0001", operationId,
        expectedSourceSha256: active.sourceSha256, expectedSnapshotSha256: target.sourceSha256 }), { code: "INJECTED_FAILPOINT" });
      const directory = path.join(target.projectRootPath, ".stemmio/transactions", `current_${operationId}`);
      const journalPath = path.join(directory, "transaction.json");
      const journal = JSON.parse(await readFile(journalPath, "utf8"));
      journal.beforeMember.fileIdentity.device += "17";
      journal.beforeMember.fileIdentity.inode += "23";
      await writeFile(journalPath, JSON.stringify(journal));
      if (replace) {
        const bytes = await readFile(target.exactSourcePath);
        await unlink(target.exactSourcePath);
        await writeFile(target.exactSourcePath, bytes);
      }
      const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
      if (replace) await assert.rejects(restarted.recoverProject({ projectRootPath: target.projectRootPath }), { code: "WORKING_COPY_CONFLICT" });
      else await restarted.recoverProject({ projectRootPath: target.projectRootPath });
      const result = await restarted.queryHistoryCreation({ target, operationId });
      assert.equal(result.status, replace ? "not-created" : "created");
      assert.equal(await readFile(target.exactSourcePath, "utf8"), stage === "prepared" && replace ? html("local") : html("V1"));
    });
  }
}

import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import { createDeviceIdentifier } from "../shared/provenance.mjs";
import {
  ProjectFileRepository,
  ProjectFileRepositoryError,
} from "../bridge/project-file-repository.mjs";
import {
  inspectSourceElementIdentity,
  sourceElementIdentityBindingSha256,
} from "../bridge/project-file-repository/working-copy.mjs";
import {
  fixture,
  html,
  importSource,
  json,
  prepareAiTaskRequest,
} from "./project-file-repository-harness.mjs";

async function optionalFileBytes(filePath) {
  try {
    return await readFile(filePath);
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    throw cause;
  }
}

test("save conflicts when both Stemmio and disk changed", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-boundary.html");
  const externalHtml = html("external edit before save write");
  const repository = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      if (name === "save-prepared") {
        await writeFile(imported.target.exactSourcePath, externalHtml, "utf8");
      }
      return false;
    },
  });

  await assert.rejects(
    repository.saveWorkingCopy({
      target: imported.target,
      html: html("Stemmio save that must not overwrite"),
      expectedSourceSha256: imported.target.sourceSha256,
      editRevision: 1,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "WORKING_COPY_CONFLICT",
  );

  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), externalHtml);
});

test("save silently adopts external disk bytes when Stemmio has no dirty buffer", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-clean-adopt.html");
  const adoptedHtml = html("external clean change");
  await writeFile(imported.target.exactSourcePath, adoptedHtml, "utf8");

  const saved = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: html("V1"),
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 0,
  });

  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), adoptedHtml);
  assert.equal(saved.currentSha256, sha256(Buffer.from(adoptedHtml, "utf8")));
  const state = await json(path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "working-copies",
    `${imported.target.workingCopyId}.json`,
  ));
  assert.equal(state.saveState, "saved");
  assert.equal(state.currentSha256, saved.currentSha256);
});

test("workspace recovers a legacy parked save journal to complete new bytes", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-legacy-parked.html");
  const previousHtml = html("V1");
  const nextHtml = html("recovered from legacy parked journal");
  const recoveryId = `save_${imported.target.workingCopyId}_1_${"a".repeat(32)}`;
  const recoveryRoot = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "recovery",
    recoveryId,
  );
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "manifest.json",
  ));
  const workingCopy = manifest.workingCopies.find(
    (entry) => entry.workingCopyId === imported.target.workingCopyId,
  );
  await mkdir(recoveryRoot, { recursive: true });
  await writeFile(path.join(recoveryRoot, "previous.html"), previousHtml, "utf8");
  await writeFile(path.join(recoveryRoot, "next.html"), nextHtml, "utf8");
  await rm(imported.target.exactSourcePath);
  await writeFile(path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "transactions",
    `${recoveryId}.json`,
  ), JSON.stringify({
    schemaVersion: "4.0.0",
    kind: "save",
    state: "source-parked",
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    workingCopyId: imported.target.workingCopyId,
    sourceRelativePath: workingCopy.sourceRelativePath,
    expectedSourceSha256: imported.target.sourceSha256,
    targetSourceSha256: sha256(Buffer.from(nextHtml, "utf8")),
    editRevision: 1,
    recoveryId,
    preparedAt: "2026-08-15T00:00:00.000Z",
  }), "utf8");

  const reopened = await new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(reopened.content, nextHtml);
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), nextHtml);
});

test("workspace recovers a legacy parked journal whose previous inode changed", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-legacy-parked-conflict.html");
  const previousHtml = html("external descriptor write after publication");
  const nextHtml = html("Stemmio save survives beside external write");
  const recoveryId = `save_${imported.target.workingCopyId}_1_${"b".repeat(32)}`;
  const recoveryRoot = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "recovery",
    recoveryId,
  );
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "manifest.json",
  ));
  const workingCopy = manifest.workingCopies.find(
    (entry) => entry.workingCopyId === imported.target.workingCopyId,
  );
  await mkdir(recoveryRoot, { recursive: true });
  await writeFile(path.join(recoveryRoot, "previous.html"), previousHtml, "utf8");
  await writeFile(path.join(recoveryRoot, "next.html"), nextHtml, "utf8");
  await writeFile(imported.target.exactSourcePath, nextHtml, "utf8");
  await writeFile(path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "transactions",
    `${recoveryId}.json`,
  ), JSON.stringify({
    schemaVersion: "4.0.0",
    kind: "save",
    state: "committed",
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    workingCopyId: imported.target.workingCopyId,
    sourceRelativePath: workingCopy.sourceRelativePath,
    expectedSourceSha256: imported.target.sourceSha256,
    targetSourceSha256: sha256(Buffer.from(nextHtml, "utf8")),
    editRevision: 1,
    recoveryId,
    preparedAt: "2026-08-15T00:00:00.000Z",
    committedAt: "2026-08-15T00:00:01.000Z",
  }), "utf8");

  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
      sourcePath: imported.target.exactSourcePath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "SAVE_RECOVERY_CONFLICT",
  );
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), nextHtml);
  assert.equal(await readFile(path.join(recoveryRoot, "previous.html"), "utf8"), previousHtml);
});

test("save refuses a missing Working Copy state before replacing HTML", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-state-boundary.html");
  const statePath = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "working-copies",
    `${imported.target.workingCopyId}.json`,
  );
  await rm(statePath);

  await assert.rejects(
    value.repository.saveWorkingCopy({
      target: imported.target,
      html: html("must stay in memory"),
      expectedSourceSha256: imported.target.sourceSha256,
      editRevision: 1,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "WORKING_COPY_STATE_NOT_FOUND",
  );

  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), html("V1"));
});

test("workspace recovers a source after a post-rename save crash", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-parked-recovery.html");
  const nextHtml = html("recovered after safe parking");
  const failing = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => name === "save-source-written",
  });

  await assert.rejects(
    failing.saveWorkingCopy({
      target: imported.target,
      html: nextHtml,
      expectedSourceSha256: imported.target.sourceSha256,
      editRevision: 1,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );

  const reopened = await new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(reopened.content, nextHtml);
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), nextHtml);
});

test("same-parent root and Working Copy renames preserve identity; moves outside stop writes until return", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const renamedRoot = path.join(value.projects, "移动后项目");
  await rename(imported.target.projectRootPath, renamedRoot);

  let saved = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: html("after folder rename"),
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 1,
  });
  assert.equal(saved.target.projectRootPath, renamedRoot);
  assert.equal(saved.target.projectId, imported.target.projectId);

  const renamedHtml = path.join(renamedRoot, "用户改名.html");
  await rename(saved.target.exactSourcePath, renamedHtml);
  saved = await value.repository.saveWorkingCopy({
    target: saved.target,
    html: html("after html rename"),
    expectedSourceSha256: saved.target.sourceSha256,
    editRevision: 2,
  });
  assert.equal(saved.target.exactSourcePath, renamedHtml);
  assert.equal(saved.target.projectId, imported.target.projectId);
  const manifestAfterRename = await json(path.join(
    renamedRoot,
    ".stemmio",
    "manifest.json",
  ));
  assert.equal(manifestAfterRename.workingCopies[0].sourceRelativePath, "用户改名.html");
  assert.equal(manifestAfterRename.workingCopies[0].preferredFileStem, "用户改名");

  const outside = path.join(value.root, "outside");
  await mkdir(outside);
  const movedRoot = path.join(outside, "far-away");
  await rename(renamedRoot, movedRoot);
  await assert.rejects(
    value.repository.saveWorkingCopy({
      target: saved.target,
      html: html("must not write old root"),
      expectedSourceSha256: saved.target.sourceSha256,
      editRevision: 3,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "REGISTERED_PROJECT_UNAVAILABLE",
  );
  assert.equal(await readFile(path.join(movedRoot, "用户改名.html"), "utf8"), html("after html rename"));

  const external = await value.repository.resolveOpenTarget({
    sourcePath: path.join(movedRoot, "用户改名.html"),
  });
  assert.equal(external, null);

  await rename(movedRoot, renamedRoot);
  const resumed = await value.repository.resolveOpenTarget({
    sourcePath: path.join(renamedRoot, "用户改名.html"),
  });
  assert.equal(resumed.projectId, imported.target.projectId);
  assert.equal(resumed.projectRootPath, renamedRoot);
  const afterReturn = await value.repository.saveWorkingCopy({
    target: resumed,
    html: html("after return"),
    expectedSourceSha256: resumed.sourceSha256,
    editRevision: 3,
  });
  assert.equal(await readFile(afterReturn.target.exactSourcePath, "utf8"), html("after return"));
});

test("a cross-volume-style move remains external until the project returns to its exact registered path", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "跨卷.html");
  const movedRoot = path.join(value.root, "other-volume", "跨卷项目");
  await mkdir(path.dirname(movedRoot), { recursive: true });

  // A real cross-volume Finder move is copy + delete.  cp() gives the moved
  // tree new file identities even when the test runner has only one volume.
  await cp(imported.target.projectRootPath, movedRoot, { recursive: true });
  await rm(imported.target.projectRootPath, { recursive: true, force: true });
  const movedHtml = path.join(movedRoot, path.basename(imported.target.exactSourcePath));

  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  assert.equal(await restarted.resolveOpenTarget({ sourcePath: movedHtml }), null);
  await assert.rejects(
    restarted.saveWorkingCopy({
      target: imported.target,
      html: html("must not follow cross-volume move"),
      expectedSourceSha256: imported.target.sourceSha256,
      editRevision: 1,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "REGISTERED_PROJECT_UNAVAILABLE",
  );
  assert.equal(await readFile(movedHtml, "utf8"), html("V1"));

  // A return to the exact registered path can safely resume after v4 IDs and
  // manifest validate, even though the copied directory has a new inode.
  await cp(movedRoot, imported.target.projectRootPath, { recursive: true });
  const returnedHtml = path.join(
    imported.target.projectRootPath,
    path.basename(imported.target.exactSourcePath),
  );
  const returned = await restarted.resolveOpenTarget({ sourcePath: returnedHtml });
  assert.equal(returned.projectId, imported.target.projectId);
  const saved = await restarted.saveWorkingCopy({
    target: returned,
    html: html("after registered return"),
    expectedSourceSha256: returned.sourceSha256,
    editRevision: 1,
  });
  assert.equal(saved.target.projectId, imported.target.projectId);
  assert.equal(await readFile(returnedHtml, "utf8"), html("after registered return"));

  // A copied project is an external HTML, even when it carries a .stemmio
  // directory. Its first persistence starts a fresh V1 without copied history.
  const importedCopy = await restarted.importExternal({
    sourcePath: movedHtml,
    expectedSourceSha256: imported.target.sourceSha256,
  });
  assert.equal(importedCopy.imported, true);
  assert.notEqual(importedCopy.target.projectId, imported.target.projectId);
  const copiedManifest = await json(path.join(
    importedCopy.target.projectRootPath,
    ".stemmio",
    "manifest.json",
  ));
  assert.deepEqual(copiedManifest.versions.map((version) => version.versionId), ["ver_0001"]);
});

test("macOS /private/var spelling resolves the same managed Working Copy without a duplicate prompt", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("macOS path-alias regression");
    return;
  }
  const value = await fixture(t);
  const imported = await importSource(value, "路径别名.html");
  const privateSpelling = imported.target.exactSourcePath === "/var"
    || imported.target.exactSourcePath.startsWith("/var/")
    ? `/private${imported.target.exactSourcePath}`
    : imported.target.exactSourcePath;
  if (privateSpelling === imported.target.exactSourcePath) {
    t.skip("temporary directory is not exposed through /var");
    return;
  }

  const resolved = await value.repository.resolveOpenTarget({
    sourcePath: privateSpelling,
  });
  const workspace = await value.repository.workspace({
    sourcePath: privateSpelling,
  });
  assert.equal(resolved.projectId, imported.target.projectId);
  assert.equal(resolved.workingCopyId, imported.target.workingCopyId);
  assert.equal(workspace.target.projectId, imported.target.projectId);
  assert.equal(workspace.target.workingCopyId, imported.target.workingCopyId);
});

test("a clean Working Copy adopts external disk bytes; pending Stemmio edits remain a conflict", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "external-change.html");
  const adoptedHtml = html("external clean change");
  await writeFile(imported.target.exactSourcePath, adoptedHtml, "utf8");

  const adopted = await value.repository.workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(adopted.workingCopyRecovered, true);
  assert.equal(adopted.content, adoptedHtml);
  assert.equal(adopted.workingCopyState.currentSha256, sha256(Buffer.from(adoptedHtml, "utf8")));
  assert.equal(
    adopted.workingCopies.find(
      (workingCopy) => workingCopy.workingCopyId === imported.target.workingCopyId,
    )?.differsFromBase,
    true,
  );

  const statePath = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "working-copies",
    "work_ver_0001.json",
  );
  const state = await json(statePath);
  await writeFile(statePath, JSON.stringify({ ...state, saveState: "failed" }), "utf8");
  const conflictingDiskHtml = html("external while Stemmio pending");
  await writeFile(imported.target.exactSourcePath, conflictingDiskHtml, "utf8");

  await assert.rejects(
    value.repository.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "WORKING_COPY_CONFLICT",
  );
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), conflictingDiskHtml);
});

test("forceUnlockWorkingCopy adopts disk hash without rewriting HTML", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "force-unlock.html");
  const statePath = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "working-copies",
    `${imported.target.workingCopyId}.json`,
  );
  const state = await json(statePath);
  await writeFile(statePath, JSON.stringify({ ...state, saveState: "failed" }), "utf8");
  const conflictingDiskHtml = html("external while Stemmio pending");
  await writeFile(imported.target.exactSourcePath, conflictingDiskHtml, "utf8");
  const runtimePath = path.join(imported.target.projectRootPath, ".stemmio", "runtime.json");

  await assert.rejects(
    value.repository.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "WORKING_COPY_CONFLICT",
  );

  const identityMismatchSnapshot = {
    source: await readFile(imported.target.exactSourcePath, "utf8"),
    state: await readFile(statePath, "utf8"),
    runtime: await optionalFileBytes(runtimePath),
  };
  for (const identity of [
    {
      projectId: imported.target.projectId === `project_${"f".repeat(32)}`
        ? `project_${"e".repeat(32)}`
        : `project_${"f".repeat(32)}`,
      documentId: imported.target.documentId,
    },
    {
      projectId: imported.target.projectId,
      documentId: imported.target.documentId === `doc_${"f".repeat(32)}`
        ? `doc_${"e".repeat(32)}`
        : `doc_${"f".repeat(32)}`,
    },
  ]) {
    await assert.rejects(
      value.repository.forceUnlockWorkingCopy({
        ...identity,
        sourcePath: imported.target.exactSourcePath,
        operationId: "force_unlock_identity_mismatch_01",
        expectedSourceSha256: sha256(Buffer.from(conflictingDiskHtml, "utf8")),
      }),
      (error) => error instanceof ProjectFileRepositoryError
        && error.code === "SOURCE_IDENTITY_MISMATCH",
    );
    assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), identityMismatchSnapshot.source);
    assert.equal(await readFile(statePath, "utf8"), identityMismatchSnapshot.state);
    assert.deepEqual(await optionalFileBytes(runtimePath), identityMismatchSnapshot.runtime);
  }

  await assert.rejects(
    value.repository.forceUnlockWorkingCopy({
      projectId: imported.target.projectId,
      documentId: imported.target.documentId,
      sourcePath: imported.target.exactSourcePath,
      operationId: "force_unlock_stale_preview_01",
      expectedSourceSha256: sha256(Buffer.from("stale preview", "utf8")),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "SOURCE_HASH_CONFLICT",
  );
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), conflictingDiskHtml);
  assert.equal((await json(statePath)).saveState, "failed");

  const unlocked = await value.repository.forceUnlockWorkingCopy({
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    sourcePath: imported.target.exactSourcePath,
    operationId: "force_unlock_adopt_disk_01",
    expectedSourceSha256: sha256(Buffer.from(conflictingDiskHtml, "utf8")),
  });
  assert.equal(unlocked.status, "force-unlocked");
  assert.equal(unlocked.content, conflictingDiskHtml);
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), conflictingDiskHtml);

  const nextState = await json(statePath);
  assert.equal(nextState.saveState, "saved");
  assert.equal(nextState.currentSha256, sha256(Buffer.from(conflictingDiskHtml, "utf8")));
  assert.equal(nextState.lastPersistedRevision, state.lastPersistedRevision);

  const workspace = await value.repository.workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(workspace.content, conflictingDiskHtml);
});

test("forceUnlockWorkingCopy reconciles the original receipt after the final reply window is lost", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "force-unlock-lost-reply.html");
  const statePath = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "working-copies",
    `${imported.target.workingCopyId}.json`,
  );
  const state = await json(statePath);
  await writeFile(statePath, JSON.stringify({ ...state, saveState: "failed" }), "utf8");
  const externalHtml = html("force unlock durable before reply");
  await writeFile(imported.target.exactSourcePath, externalHtml, "utf8");
  const operationId = "force_unlock_lost_reply_01";
  const writer = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      if (name === "force-unlock-before-completed-receipt") {
        throw new Error("force-unlock reply window lost");
      }
      return false;
    },
  });

  await assert.rejects(writer.forceUnlockWorkingCopy({
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    sourcePath: imported.target.exactSourcePath,
    operationId,
    expectedSourceSha256: sha256(Buffer.from(externalHtml, "utf8")),
  }), /reply window lost/u);

  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  await restarted.initialize();
  const reconciled = await restarted.queryForceUnlockWorkingCopy({
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    sourcePath: imported.target.exactSourcePath,
    operationId,
  });
  assert.equal(reconciled.status, "force-unlocked");
  assert.equal(reconciled.operationId, operationId);
  assert.equal(reconciled.acceptedSourceSha256, sha256(Buffer.from(externalHtml, "utf8")));
  assert.equal(reconciled.content, await readFile(imported.target.exactSourcePath, "utf8"));

  const nextExternalHtml = reconciled.content.replace(
    "force unlock durable before reply",
    "second bounded force unlock",
  );
  await writeFile(imported.target.exactSourcePath, nextExternalHtml, "utf8");
  await restarted.forceUnlockWorkingCopy({
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    sourcePath: imported.target.exactSourcePath,
    operationId: "force_unlock_lost_reply_02",
    expectedSourceSha256: sha256(Buffer.from(nextExternalHtml, "utf8")),
  });
  const identityTransactions = (await readdir(path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "transactions",
  ))).filter((name) => name.startsWith(`identity_${imported.target.workingCopyId}_`));
  assert.equal(identityTransactions.length, 1);
});

for (const failpoint of [
  "force-unlock-pending-receipt-written",
  "force-unlock-adopted-state-written",
  "identity-migration-source-written",
  "identity-migration-metadata-written",
]) {
  test(`force-unlock recovery completes the original operation after ${failpoint}`, async (t) => {
    const value = await fixture(t);
    const imported = await importSource(value, `force-unlock-recovery-${failpoint}.html`);
    await prepareAiTaskRequest(
      value.repository,
      imported.target,
      `req_force_unlock_${failpoint.replaceAll("-", "_")}`,
    );
    const statePath = path.join(
      imported.target.projectRootPath,
      ".stemmio",
      "working-copies",
      `${imported.target.workingCopyId}.json`,
    );
    const state = await json(statePath);
    await writeFile(statePath, JSON.stringify({ ...state, saveState: "failed" }), "utf8");
    const externalHtml = `<!doctype html><html><head><title>${failpoint}</title></head><body><h1>external</h1></body></html>\n`;
    const acceptedSourceSha256 = sha256(Buffer.from(externalHtml, "utf8"));
    await writeFile(imported.target.exactSourcePath, externalHtml, "utf8");
    const operationId = `force_unlock_recovery_${failpoint.replaceAll("-", "_")}`;
    const interrupted = new ProjectFileRepository({
      projectsRoot: value.projects,
      failpoint: async (name) => name === failpoint,
    });

    await assert.rejects(interrupted.forceUnlockWorkingCopy({
      projectId: imported.target.projectId,
      documentId: imported.target.documentId,
      sourcePath: imported.target.exactSourcePath,
      operationId,
      expectedSourceSha256: acceptedSourceSha256,
    }), (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT");

    const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
    await restarted.initialize();
    const reconciled = await restarted.queryForceUnlockWorkingCopy({
      projectId: imported.target.projectId,
      documentId: imported.target.documentId,
      sourcePath: imported.target.exactSourcePath,
      operationId,
    });
    assert.equal(reconciled.status, "force-unlocked");
    assert.equal(reconciled.operationId, operationId);
    assert.equal(reconciled.acceptedSourceSha256, acceptedSourceSha256);
    assert.notEqual(reconciled.sourceSha256, acceptedSourceSha256);
    const recoveredState = await json(statePath);
    assert.equal(recoveredState.forceUnlockReceipt.status, "completed");
    const runtime = await json(path.join(
      imported.target.projectRootPath,
      ".stemmio",
      "runtime-state.json",
    ));
    assert.equal(runtime.activeRequest, null);
  });
}

test("a newer force-unlock cannot overwrite an unresolved original operation", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "force-unlock-pending-slot.html");
  const statePath = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "working-copies",
    `${imported.target.workingCopyId}.json`,
  );
  const state = await json(statePath);
  await writeFile(statePath, JSON.stringify({ ...state, saveState: "failed" }), "utf8");
  const externalHtml = "<!doctype html><html><head><title>pending slot</title></head><body><h1>external</h1></body></html>\n";
  const acceptedSourceSha256 = sha256(Buffer.from(externalHtml, "utf8"));
  await writeFile(imported.target.exactSourcePath, externalHtml, "utf8");
  const originalOperationId = "force_unlock_pending_slot_original";
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => name === "force-unlock-pending-receipt-written",
  });
  await assert.rejects(interrupted.forceUnlockWorkingCopy({
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    sourcePath: imported.target.exactSourcePath,
    operationId: originalOperationId,
    expectedSourceSha256: acceptedSourceSha256,
  }), (error) => error instanceof ProjectFileRepositoryError
    && error.code === "INJECTED_FAILPOINT");

  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  await restarted.initialize();
  await assert.rejects(restarted.forceUnlockWorkingCopy({
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    sourcePath: imported.target.exactSourcePath,
    operationId: "force_unlock_pending_slot_newer",
    expectedSourceSha256: acceptedSourceSha256,
  }), (error) => error instanceof ProjectFileRepositoryError
    && error.code === "SOURCE_HASH_CONFLICT");

  const original = await restarted.queryForceUnlockWorkingCopy({
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    sourcePath: imported.target.exactSourcePath,
    operationId: originalOperationId,
  });
  assert.equal(original.status, "force-unlocked");
  const settledState = await json(statePath);
  assert.equal(settledState.forceUnlockReceipt.status, "completed");
  assert.equal(settledState.forceUnlockReceipt.operationId, originalOperationId);
});

for (const failpoint of [
  "identity-migration-prepared",
  "identity-migration-source-written",
]) {
  test(`a third external Hash supersedes interrupted force-unlock after ${failpoint}`, async (t) => {
    const value = await fixture(t);
    const imported = await importSource(value, `force-unlock-superseded-${failpoint}.html`);
    await prepareAiTaskRequest(
      value.repository,
      imported.target,
      `req_force_unlock_superseded_${failpoint.replaceAll("-", "_")}`,
    );
    const statePath = path.join(
      imported.target.projectRootPath,
      ".stemmio",
      "working-copies",
      `${imported.target.workingCopyId}.json`,
    );
    const state = await json(statePath);
    await writeFile(statePath, JSON.stringify({ ...state, saveState: "failed" }), "utf8");
    const previewedHtml = `<!doctype html><html><head><title>${failpoint}</title></head><body><h1>previewed</h1></body></html>\n`;
    const thirdPartyHtml = "<!doctype html><html><head><title>third party</title></head><body><h1>newer external</h1></body></html>\n";
    const acceptedSourceSha256 = sha256(Buffer.from(previewedHtml, "utf8"));
    await writeFile(imported.target.exactSourcePath, previewedHtml, "utf8");
    const operationId = `force_unlock_superseded_${failpoint.replaceAll("-", "_")}`;
    const interrupted = new ProjectFileRepository({
      projectsRoot: value.projects,
      failpoint: async (name) => name === failpoint,
    });
    await assert.rejects(interrupted.forceUnlockWorkingCopy({
      projectId: imported.target.projectId,
      documentId: imported.target.documentId,
      sourcePath: imported.target.exactSourcePath,
      operationId,
      expectedSourceSha256: acceptedSourceSha256,
    }), (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT");
    await writeFile(imported.target.exactSourcePath, thirdPartyHtml, "utf8");

    const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
    await restarted.initialize();
    const reconciled = await restarted.queryForceUnlockWorkingCopy({
      projectId: imported.target.projectId,
      documentId: imported.target.documentId,
      sourcePath: imported.target.exactSourcePath,
      operationId,
    });
    assert.equal(reconciled.status, "superseded");
    assert.equal(reconciled.operationId, operationId);
    assert.equal(reconciled.sourceSha256, sha256(Buffer.from(thirdPartyHtml, "utf8")));
    assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), thirdPartyHtml);
    const supersededState = await json(statePath);
    assert.equal(supersededState.forceUnlockReceipt.status, "superseded");
    assert.equal(supersededState.forceUnlockReceipt.operationId, operationId);
    const repeatedSuperseded = await restarted.queryForceUnlockWorkingCopy({
      projectId: imported.target.projectId,
      documentId: imported.target.documentId,
      sourcePath: imported.target.exactSourcePath,
      operationId,
    });
    assert.equal(repeatedSuperseded.status, "superseded");
    assert.equal(repeatedSuperseded.operationId, operationId);

    const replacement = await restarted.forceUnlockWorkingCopy({
      projectId: imported.target.projectId,
      documentId: imported.target.documentId,
      sourcePath: imported.target.exactSourcePath,
      operationId: `${operationId}_replacement`,
      expectedSourceSha256: sha256(Buffer.from(thirdPartyHtml, "utf8")),
    });
    assert.equal(replacement.status, "force-unlocked");
    assert.match(replacement.content, /data-stemmio-id=/u);
  });
}

test("forceUnlockWorkingCopy rematerializes identities after explicitly adopting unmarked disk HTML", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "force-unlock-unmarked.html");
  const statePath = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "working-copies",
    `${imported.target.workingCopyId}.json`,
  );
  const state = await json(statePath);
  const conflictingDiskHtml = "<!doctype html><html><head><title>external</title></head><body><h1>external</h1></body></html>\n";
  await writeFile(imported.target.exactSourcePath, conflictingDiskHtml, "utf8");

  const unlocked = await value.repository.forceUnlockWorkingCopy({
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    sourcePath: imported.target.exactSourcePath,
    operationId: "force_unlock_unmarked_01",
    expectedSourceSha256: sha256(Buffer.from(conflictingDiskHtml, "utf8")),
  });
  assert.equal(unlocked.status, "force-unlocked");
  assert.match(unlocked.content, /<h1 data-stemmio-id="sm1_[0-9a-f]{32}">external<\/h1>/u);
  assert.equal(unlocked.content, await readFile(imported.target.exactSourcePath, "utf8"));
  const nextState = await json(statePath);
  assert.equal(nextState.sourceElementIdentitySchemaVersion, 1);
  assert.equal(nextState.currentSha256, sha256(Buffer.from(unlocked.content, "utf8")));
  assert.equal(nextState.differsFromBase, true);
  assert.equal(nextState.lastPersistedRevision, state.lastPersistedRevision);
});

test("force-unlock keeps identity-CAS races unresolved and ordinary workspace cannot adopt them", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "force-unlock-identity-race.html");
  const statePath = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "working-copies",
    `${imported.target.workingCopyId}.json`,
  );
  const state = await json(statePath);
  await writeFile(statePath, JSON.stringify({ ...state, saveState: "failed" }), "utf8");
  const previewedHtml = "<!doctype html><html><head><title>previewed</title></head><body><h1>previewed external</h1></body></html>\n";
  const racedHtml = "<!doctype html><html><head><title>raced</title></head><body><h1>unpreviewed race</h1></body></html>\n";
  await writeFile(imported.target.exactSourcePath, previewedHtml, "utf8");
  const writer = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      if (name === "identity-migration-prepared") {
        await writeFile(imported.target.exactSourcePath, racedHtml, "utf8");
      }
      return false;
    },
  });

  await assert.rejects(writer.forceUnlockWorkingCopy({
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    sourcePath: imported.target.exactSourcePath,
    operationId: "force_unlock_identity_race_01",
    expectedSourceSha256: sha256(Buffer.from(previewedHtml, "utf8")),
  }), (error) => error instanceof ProjectFileRepositoryError
    && error.code === "WORKING_COPY_CONFLICT");

  const unresolved = await json(statePath);
  assert.equal(unresolved.saveState, "saving");
  assert.equal(unresolved.forceUnlockReceipt.status, "pending");
  assert.equal(unresolved.currentSha256, sha256(Buffer.from(previewedHtml, "utf8")));
  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
      sourcePath: imported.target.exactSourcePath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "WORKING_COPY_CONFLICT",
  );
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), racedHtml);
  assert.equal((await json(statePath)).currentSha256, unresolved.currentSha256);
});

test("external ID swaps require explicit adoption before their bindings change", async (t) => {
  const value = await fixture(t);
  const sourceHtml = html("V1").replace(
    /<h1 data-stemmio-id="([^"]+)">V1<\/h1>/u,
    '<p data-stemmio-id="$1">first</p>'
      + '<p data-stemmio-id="sm1_6666666666664666a666666666666666">second</p>',
  );
  const imported = await importSource(value, "external-id-swap.html", sourceHtml);
  const managed = await readFile(imported.target.exactSourcePath, "utf8");
  const paragraphIds = inspectSourceElementIdentity(managed).elements
    .filter((element) => element.tagName === "p")
    .map((element) => element.stemmioId);
  assert.equal(paragraphIds.length, 2);
  const swapped = managed
    .replace(paragraphIds[0], "__stemmio_first_id__")
    .replace(paragraphIds[1], paragraphIds[0])
    .replace("__stemmio_first_id__", paragraphIds[1]);
  await writeFile(imported.target.exactSourcePath, swapped, "utf8");
  const statePath = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "working-copies",
    `${imported.target.workingCopyId}.json`,
  );
  const beforeState = await json(statePath);

  await assert.rejects(
    value.repository.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "WORKING_COPY_CONFLICT"
      && error.details.diskBindingSha256 !== error.details.recordedBindingSha256,
  );
  assert.equal((await json(statePath)).currentSha256, beforeState.currentSha256);

  const unlocked = await value.repository.forceUnlockWorkingCopy({
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    sourcePath: imported.target.exactSourcePath,
    operationId: "force_unlock_id_swap_01",
    expectedSourceSha256: sha256(Buffer.from(swapped, "utf8")),
  });
  assert.equal(unlocked.content, swapped);
  const adoptedState = await json(statePath);
  assert.equal(
    adoptedState.sourceElementIdentityBindingSha256,
    sourceElementIdentityBindingSha256(swapped),
  );
});

test("force-unlock repairs identity loss even after its disk Hash was recorded", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "recorded-identity-loss.html");
  const managed = await readFile(imported.target.exactSourcePath, "utf8");
  const unmarked = managed.replace(/ data-stemmio-id="sm1_[a-f0-9]{32}"/gu, "");
  await writeFile(imported.target.exactSourcePath, unmarked, "utf8");
  const statePath = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "working-copies",
    `${imported.target.workingCopyId}.json`,
  );
  const recordedState = await json(statePath);
  recordedState.currentSha256 = sha256(Buffer.from(unmarked, "utf8"));
  recordedState.differsFromBase = recordedState.currentSha256 !== recordedState.baseSha256;
  delete recordedState.sourceElementIdentityBindingSha256;
  await writeFile(statePath, `${JSON.stringify(recordedState, null, 2)}\n`, "utf8");

  await assert.rejects(
    value.repository.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "WORKING_COPY_CONFLICT",
  );
  const unlocked = await value.repository.forceUnlockWorkingCopy({
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    sourcePath: imported.target.exactSourcePath,
    operationId: "force_unlock_identity_loss_01",
    expectedSourceSha256: sha256(Buffer.from(unmarked, "utf8")),
  });
  assert.equal(inspectSourceElementIdentity(unlocked.content).complete, true);
  assert.notEqual(unlocked.content, unmarked);
  const repairedState = await json(statePath);
  assert.equal(repairedState.sourceElementIdentitySchemaVersion, 1);
  assert.equal(
    repairedState.sourceElementIdentityBindingSha256,
    sourceElementIdentityBindingSha256(unlocked.content),
  );
});

test("forceUnlockWorkingCopy clears a stuck activeRequest without rewriting HTML", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "force-unlock-active-run.html");
  await prepareAiTaskRequest(value.repository, imported.target, "req_force_unlock_active");
  const runtimePath = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "runtime-state.json",
  );
  assert.ok((await json(runtimePath)).activeRequest);

  const statePath = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "working-copies",
    `${imported.target.workingCopyId}.json`,
  );
  const state = await json(statePath);
  await writeFile(statePath, JSON.stringify({ ...state, saveState: "failed" }), "utf8");
  const conflictingDiskHtml = html("external while request active");
  await writeFile(imported.target.exactSourcePath, conflictingDiskHtml, "utf8");

  const unlocked = await value.repository.forceUnlockWorkingCopy({
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    sourcePath: imported.target.exactSourcePath,
    operationId: "force_unlock_active_run_01",
    expectedSourceSha256: sha256(Buffer.from(conflictingDiskHtml, "utf8")),
  });
  assert.equal(unlocked.status, "force-unlocked");
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), conflictingDiskHtml);

  const runtime = await json(runtimePath);
  assert.equal(runtime.activeRequest, null);
  const workspace = await value.repository.workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(workspace.activeRequest, null);
  assert.equal(workspace.content, conflictingDiskHtml);
});

test("validation errors return an in-memory errorPreview without persisting it", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "invalid-preview.html");
  await prepareAiTaskRequest(value.repository, imported.target, "req_invalid_preview");
  const incomplete = "<html><body>truncated";
  const completed = await value.repository.completeRequest({
    target: imported.target,
    requestId: "req_invalid_preview",
    attemptId: "attempt_001",
    html: incomplete,
  });
  assert.equal(completed.status, "error");
  assert.equal(completed.request.error.errorCode, "INCOMPLETE_HTML");
  assert.match(String(completed.request.error.errorPreview || ""), /truncated/);
  const record = await json(path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "requests",
    "req_invalid_preview",
    "request.json",
  ));
  assert.equal(record.error.errorPreview, undefined);
  assert.equal(record.error.errorCode, "INCOMPLETE_HTML");
});

test("save fault injection recovers a complete durable state or a retained old state", async (t) => {
  for (const failpoint of [
    "save-prepared",
    "save-source-written",
  ]) {
    const value = await fixture(t);
    const imported = await importSource(value, "save-fault.html");
    const nextHtml = html(`save fault ${failpoint}`);
    const failing = new ProjectFileRepository({
      projectsRoot: value.projects,
      failpoint: async (name) => name === failpoint,
    });
    await assert.rejects(
      failing.saveWorkingCopy({
        target: imported.target,
        html: nextHtml,
        expectedSourceSha256: imported.target.sourceSha256,
        editRevision: 7,
      }),
      (error) => error instanceof ProjectFileRepositoryError
        && error.code === "INJECTED_FAILPOINT",
      failpoint,
    );

    const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
    const workspace = await restarted.workspace({ sourcePath: imported.target.exactSourcePath });
    const expectedHtml = failpoint === "save-prepared" ? html("V1") : nextHtml;
    assert.equal(workspace.content, expectedHtml, failpoint);
    assert.equal(workspace.workingCopyState.currentSha256, sha256(Buffer.from(expectedHtml)), failpoint);
    assert.equal(workspace.workingCopyState.saveState, "saved", failpoint);
    const transactions = (await readdir(path.join(
      imported.target.projectRootPath,
      ".stemmio",
      "transactions",
    ))).filter((entry) => entry.startsWith("save_"));
    assert.equal(transactions.length, failpoint === "save-prepared" ? 1 : 0, failpoint);
    if (transactions.length) {
      const transaction = await json(path.join(
        imported.target.projectRootPath,
        ".stemmio",
        "transactions",
        transactions[0],
      ));
      assert.equal(transaction.state, "committed", failpoint);
      assert.ok(transaction.recovery, "rolled-back recovery evidence remains durable");
    }
    const manifest = await json(path.join(
      imported.target.projectRootPath,
      ".stemmio",
      "manifest.json",
    ));
    assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"], failpoint);
  }
});

test("save recovery refuses an externally changed Working Copy instead of overwriting it", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-conflict.html");
  const failing = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => name === "save-source-written",
  });
  await assert.rejects(
    failing.saveWorkingCopy({
      target: imported.target,
      html: html("interrupted Stemmio save"),
      expectedSourceSha256: imported.target.sourceSha256,
      editRevision: 1,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );
  const externallyChanged = html("external change after interruption");
  await writeFile(imported.target.exactSourcePath, externallyChanged, "utf8");

  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
      sourcePath: imported.target.exactSourcePath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "SAVE_RECOVERY_CONFLICT",
  );
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), externallyChanged);
});

test("workspace validates Working Copy state before following its declared Draft path", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "state-before-draft.html");
  const controlRoot = path.join(imported.target.projectRootPath, ".stemmio");
  const statePath = path.join(controlRoot, "working-copies", "work_ver_0001.json");
  const state = await json(statePath);
  const untrustedDraftPath = path.join(controlRoot, "drafts", "untrusted.json");
  await writeFile(untrustedDraftPath, "not JSON", "utf8");
  await writeFile(statePath, JSON.stringify({
    ...state,
    draftRelativePath: "drafts/untrusted.json",
  }), "utf8");

  await assert.rejects(
    value.repository.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "WORKING_COPY_STATE_INVALID",
  );
});

test("workspace follows only the v4 Working Copy saveState vocabulary", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-state-vocabulary.html");
  const statePath = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "working-copies",
    "work_ver_0001.json",
  );
  const state = await json(statePath);

  await writeFile(statePath, JSON.stringify({ ...state, saveState: "saving" }), "utf8");
  const savingWorkspace = await value.repository.workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(savingWorkspace.workingCopyState.saveState, "saving");

  await writeFile(statePath, JSON.stringify({ ...state, saveState: "queued" }), "utf8");
  await assert.rejects(
    value.repository.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "WORKING_COPY_STATE_INVALID",
  );
});

test("workspace rejects a malformed Working Copy Draft instead of publishing an empty authority", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "malformed-draft.html");
  const draftPath = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    "drafts",
    "work_ver_0001.json",
  );
  await writeFile(draftPath, JSON.stringify({ draftRevision: 0, comments: [] }), "utf8");

  await assert.rejects(
    value.repository.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "WORKING_COPY_DRAFT_INVALID",
  );
});

test("unknown manifest and Working Copy state members survive an ordinary save", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "清单未知成员.html");
  const control = path.join(imported.target.projectRootPath, ".stemmio");
  const manifestFile = path.join(control, "manifest.json");

  const manifest = await json(manifestFile);
  manifest.ownerAccountId = "account_future";
  manifest.versions[0].provenance = { seq: 1 };
  manifest.workingCopies[0].provenance = { seq: 2 };
  manifest.workingCopies[0].fileIdentity.futureIdentity = "next";
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const stateFile = path.join(
    control,
    manifest.workingCopies[0].stateRelativePath,
  );
  const state = await json(stateFile);
  state.provenance = { seq: 3 };
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const saved = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: html("清单未知成员 saved"),
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 1,
  });
  assert.equal(saved.versionCreated, false);

  const rewrittenManifest = await json(manifestFile);
  assert.equal(rewrittenManifest.ownerAccountId, "account_future");
  assert.deepEqual(rewrittenManifest.versions[0].provenance, { seq: 1 });
  assert.deepEqual(rewrittenManifest.workingCopies[0].provenance, { seq: 2 });
  assert.equal(
    "futureIdentity" in rewrittenManifest.workingCopies[0].fileIdentity,
    false,
  );
  assert.deepEqual(
    Object.keys(rewrittenManifest.workingCopies[0].fileIdentity).sort(),
    ["birthtimeMs", "device", "inode"],
  );

  const rewrittenState = await json(stateFile);
  assert.deepEqual(rewrittenState.provenance, { seq: 3 });
  assert.equal(rewrittenState.schemaVersion, state.schemaVersion);
});

// runtime-state.json is layered rather than uniformly preserved or authored.
// Its root is spread by normalizeRuntimeDisplayAnchors, and historyActivation is
// mutated in place when the desktop confirms, so both carry a member a newer
// Stemmio added. activeRequest is replaced with a fresh literal on every status
// transition and lastAiTask is re-derived from the AI task record, so those two
// are authored and their schemas stay strict.

test("a stored Draft keeps its authoritative envelope while preserving unknown members", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value, "草稿信封.html");
  const draftFile = path.join(
    target.projectRootPath,
    ".stemmio",
    "drafts",
    `${target.workingCopyId}.json`,
  );

  await value.repository.saveDraft({
    target,
    operationId: "draftop_envelope_000001",
    expectedDraftRevision: 0,
    comments: [{ commentId: "comment_a", text: "a" }],
    changeEvents: [],
    deletedCommentIds: [],
  });
  const persisted = await json(draftFile);
  assert.equal(persisted.workingCopyId, target.workingCopyId);

  // A newer build added a member, and the envelope on disk has drifted.
  await writeFile(
    draftFile,
    `${JSON.stringify({
      ...persisted,
      schemaVersion: "9.9.9",
      workingCopyId: "work_ver_9999",
      provenance: { actor: "human" },
    }, null, 2)}\n`,
    "utf8",
  );

  await value.repository.saveDraft({
    target,
    operationId: "draftop_envelope_000002",
    expectedDraftRevision: persisted.draftRevision,
    comments: [{ commentId: "comment_a", text: "b" }],
    changeEvents: [],
    deletedCommentIds: [],
  });

  const rewritten = await json(draftFile);
  assert.equal(rewritten.schemaVersion, persisted.schemaVersion);
  assert.equal(rewritten.workingCopyId, target.workingCopyId);
  assert.equal(rewritten.projectId, target.projectId);
  assert.deepEqual(rewritten.provenance, { actor: "human" });
});

// manifest.json is mutated in place and written back as the object that was
// read, and the Working Copy state spreads the record it read before overriding
// its authoritative members. Both orderings preserve a member a newer Stemmio
// added; the stored Draft envelope above is the one that had to be corrected to
// match them.
//
// `fileIdentity` is the counter-example and the boundary of the rule. It is
// authored from a fresh stat on every save — a save publishes through an atomic
// rename, so the inode legitimately changes — and is therefore replaced, not
// round-tripped. An authored sub-record cannot carry unknown members, and its
// schema stays strict.

test("a stored Draft records the author of each comment and ignores a supplied one", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value, "作者归属.html");
  const deviceId = createDeviceIdentifier();
  const attributed = new ProjectFileRepository({
    projectsRoot: value.projects,
    deviceId,
    registryWriteLockTimeoutMs: 200,
  });
  const draftFile = path.join(
    target.projectRootPath,
    ".stemmio",
    "drafts",
    `${target.workingCopyId}.json`,
  );
  const localAuthor = { actor: { kind: "human", id: "local" }, device: deviceId };

  await attributed.saveDraft({
    target,
    operationId: "draftop_provenance_000001",
    expectedDraftRevision: 0,
    comments: [{ commentId: "comment_first", text: "first" }],
    changeEvents: [],
    deletedCommentIds: [],
  });
  const first = await json(draftFile);
  assert.deepEqual(first.comments[0].provenance, localAuthor);

  const forged = {
    actor: { kind: "agent", id: "impostor" },
    device: createDeviceIdentifier(),
  };
  await attributed.saveDraft({
    target,
    operationId: "draftop_provenance_000002",
    expectedDraftRevision: first.draftRevision,
    comments: [
      { ...first.comments[0], provenance: forged },
      { commentId: "comment_second", text: "second", provenance: forged },
    ],
    changeEvents: [],
    deletedCommentIds: [],
  });
  const second = await json(draftFile);
  const byId = Object.fromEntries(
    second.comments.map((comment) => [comment.commentId, comment]),
  );
  assert.deepEqual(byId.comment_first.provenance, localAuthor);
  assert.deepEqual(byId.comment_second.provenance, localAuthor);
});

// A repository with no device identity records no author rather than inventing
// one, so a misconfigured launch cannot attribute records to a device that does
// not exist.

test("a Draft written without a device identity records no author", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value, "无设备身份.html");
  await value.repository.saveDraft({
    target,
    operationId: "draftop_provenance_000003",
    expectedDraftRevision: 0,
    comments: [{ commentId: "comment_only", text: "only" }],
    changeEvents: [],
    deletedCommentIds: [],
  });
  const stored = await json(path.join(
    target.projectRootPath,
    ".stemmio",
    "drafts",
    `${target.workingCopyId}.json`,
  ));
  assert.equal("provenance" in stored.comments[0], false);
});

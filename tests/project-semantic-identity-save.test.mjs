import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import test from "node:test";

import { SourceHistorySession } from "../app/application/source-history-session.js";
import {
  applySemanticOperation,
  createSemanticDocumentState,
  createSemanticElementPrecondition,
} from "../app/lib/semantic-operation-kernel.js";
import {
  createDeleteElementOperation,
  createDuplicateElementOperation,
  createInsertElementOperation,
  createMoveElementOperation,
} from "../app/lib/source-structure-edit.js";
import { buildSourceIndex } from "../app/lib/source-index.js";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import {
  fixture,
  importSource,
} from "./project-file-repository-harness.mjs";

const ids = {
  html: "sm1_a0000000000040008000000000000001",
  head: "sm1_a0000000000040008000000000000002",
  title: "sm1_a0000000000040008000000000000003",
  body: "sm1_a0000000000040008000000000000004",
  left: "sm1_a0000000000040008000000000000005",
  first: "sm1_a0000000000040008000000000000006",
  strong: "sm1_a0000000000040008000000000000007",
  second: "sm1_a0000000000040008000000000000008",
  right: "sm1_a0000000000040008000000000000009",
  module: "sm1_a000000000004000800000000000000a",
};

const SOURCE = `<!doctype html><html data-stemmio-id="${ids.html}"><head data-stemmio-id="${ids.head}"><title data-stemmio-id="${ids.title}">Managed</title></head><body data-stemmio-id="${ids.body}"><section data-stemmio-id="${ids.left}"><p data-stemmio-id="${ids.first}">A <strong data-stemmio-id="${ids.strong}">one</strong></p><p data-stemmio-id="${ids.second}">B</p></section><aside data-stemmio-id="${ids.right}"><div data-stemmio-id="${ids.module}">module</div></aside></body></html>`;
const COMMENT_GAP_SOURCE = SOURCE.replace(
  `</p><p data-stemmio-id="${ids.second}">`,
  `</p>\n<!-- authored gap -->\n<p data-stemmio-id="${ids.second}">`,
);

function precondition(source, elementId) {
  return createSemanticElementPrecondition(source, elementId);
}

function operation(source, type, fields, operationId) {
  const state = createSemanticDocumentState(source);
  return {
    schemaVersion: 1,
    operationId,
    baseRevision: state.revision,
    expectedSourceSha256: state.sourceSha256,
    type,
    ...fields,
  };
}

function sourceHistoryEvidence(result, semanticOperation, editRevision = 1) {
  const materialization = result.materialization.sourcePatchResult;
  return {
    operationId: semanticOperation.operationId,
    kind: "structure",
    editRevision,
    createdAt: "2026-08-30T00:00:00.000Z",
    beforeSourceSha256: result.previousSourceSha256,
    afterSourceSha256: result.sourceSha256,
    forwardPatches: materialization.patches,
    reversePatches: materialization.inversePlan.patches,
    beforeTarget: null,
    afterTarget: null,
    semanticDirection: "forward",
    semanticOperation,
    identityDelta: result.identityDelta,
  };
}

function sequentialUuidFactory(prefix) {
  let value = 0;
  return () => `${prefix}0000-4000-8000-${String(++value).padStart(12, "0")}`;
}

async function applySave(repository, target, source, semanticOperation, {
  editRevision,
  randomUUID,
} = {}) {
  const result = applySemanticOperation(
    createSemanticDocumentState(source),
    semanticOperation,
    randomUUID ? { randomUUID } : undefined,
  );
  const saved = await repository.saveWorkingCopy({
    target,
    html: result.html,
    expectedSourceSha256: target.sourceSha256,
    editRevision,
    sourceHistoryOperations: [sourceHistoryEvidence(result, semanticOperation, editRevision)],
  });
  return { result, saved, target: saved.target, source: result.html };
}

test("managed Working Copy persists every authorized semantic identity transition across reopen", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "semantic-identity-closure.html", SOURCE);
  let target = imported.target;
  let source = await readFile(target.exactSourcePath, "utf8");
  let revision = 0;

  const setText = operation(source, "setText", {
    target: precondition(source, ids.first),
    text: "replacement",
  }, "sourceop_managed_set_text_001");
  ({ target, source } = await applySave(value.repository, target, source, setText, {
    editRevision: ++revision,
  }));
  assert.equal(buildSourceIndex(source).byStemmioId.has(ids.strong), false);

  const replace = operation(source, "replaceSubtree", {
    target: precondition(source, ids.module),
    html: "<article><img alt='new'></article>",
  }, "sourceop_managed_replace_002");
  const replaced = await applySave(value.repository, target, source, replace, {
    editRevision: ++revision,
    randomUUID: sequentialUuidFactory("11000000-"),
  });
  ({ target, source } = replaced);
  assert.equal(buildSourceIndex(source).byStemmioId.get(ids.module).tagName, "article");
  assert.equal(replaced.result.identityDelta.retainedTargetRootElementId, ids.module);
  assert.equal(replaced.result.identityDelta.addedElementIds.length, 1);

  const crossParentMove = createMoveElementOperation(source, {
    baseRevision: 0,
    operationId: "sourceop_managed_cross_move_003",
    elementId: ids.second,
    parentElementId: ids.right,
    beforeElementId: ids.module,
  });
  ({ target, source } = await applySave(value.repository, target, source, crossParentMove, {
    editRevision: ++revision,
  }));
  {
    const movedIndex = buildSourceIndex(source);
    const moved = movedIndex.byStemmioId.get(ids.second);
    assert.equal(movedIndex.byNodeId.get(moved.parentId).stemmioId, ids.right);
  }

  const sameParentMove = createMoveElementOperation(source, {
    baseRevision: 0,
    operationId: "sourceop_managed_same_move_004",
    elementId: ids.module,
    parentElementId: ids.right,
    beforeElementId: ids.second,
  });
  ({ target, source } = await applySave(value.repository, target, source, sameParentMove, {
    editRevision: ++revision,
  }));

  const insert = createInsertElementOperation(source, {
    baseRevision: 0,
    operationId: "sourceop_managed_insert_005",
    parentElementId: ids.left,
    beforeElementId: null,
    html: "<section><span>inserted</span></section>",
  });
  const inserted = await applySave(value.repository, target, source, insert, {
    editRevision: ++revision,
    randomUUID: sequentialUuidFactory("22000000-"),
  });
  ({ target, source } = inserted);
  assert.equal(inserted.result.identityDelta.addedElementIds.length, 2);

  const duplicate = createDuplicateElementOperation(source, {
    baseRevision: 0,
    operationId: "sourceop_managed_duplicate_006",
    elementId: ids.module,
  });
  const duplicated = await applySave(value.repository, target, source, duplicate, {
    editRevision: ++revision,
    randomUUID: sequentialUuidFactory("33000000-"),
  });
  ({ target, source } = duplicated);
  assert.ok(duplicated.result.identityDelta.addedElementIds.length >= 2);

  const deleting = operation(source, "deleteElement", {
    target: precondition(source, ids.first),
  }, "sourceop_managed_delete_007");
  ({ target, source } = await applySave(value.repository, target, source, deleting, {
    editRevision: ++revision,
  }));
  assert.equal(buildSourceIndex(source).byStemmioId.has(ids.first), false);

  const reopened = await new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
    sourcePath: target.exactSourcePath,
  });
  assert.equal(reopened.content, source);
  assert.equal(reopened.sourceSha256, sha256(Buffer.from(source, "utf8")));
  assert.equal(reopened.workingCopyState.currentSha256, reopened.sourceSha256);
  assert.match(
    reopened.workingCopyState.sourceElementIdentityBindingSha256,
    /^sha256:[a-f0-9]{64}$/u,
  );
});

test("comment-gap duplicate undo redo move and delete stay replayable across Repository saves", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(
    value,
    "semantic-comment-gap-closure.html",
    COMMENT_GAP_SOURCE,
  );
  let target = imported.target;
  let source = await readFile(target.exactSourcePath, "utf8");

  const duplicateOperation = createDuplicateElementOperation(source, {
    baseRevision: 0,
    operationId: "sourceop_comment_duplicate_001",
    elementId: ids.second,
  });
  const duplicated = await applySave(
    value.repository,
    target,
    source,
    duplicateOperation,
    {
      editRevision: 1,
      randomUUID: sequentialUuidFactory("44000000-"),
    },
  );
  ({ target, source } = duplicated);

  const undone = applySemanticOperation(
    duplicated.result.nextState,
    duplicated.result.inverseOperation,
  );
  assert.equal(undone.html, COMMENT_GAP_SOURCE);
  const redone = applySemanticOperation(undone.nextState, undone.inverseOperation);
  assert.equal(redone.html, source);

  const moveOperation = createMoveElementOperation(redone.html, {
    baseRevision: 0,
    operationId: "sourceop_comment_move_002",
    elementId: duplicated.result.insertedRootElementId,
    parentElementId: ids.left,
    beforeElementId: ids.second,
  });
  ({ target, source } = await applySave(
    value.repository,
    target,
    redone.html,
    moveOperation,
    { editRevision: 2 },
  ));
  const reopenedAfterMove = await new ProjectFileRepository({
    projectsRoot: value.projects,
  }).workspace({ sourcePath: target.exactSourcePath });
  assert.equal(reopenedAfterMove.content, source);

  const deleteOperation = createDeleteElementOperation(source, {
    baseRevision: 0,
    operationId: "sourceop_comment_delete_003",
    elementId: duplicated.result.insertedRootElementId,
  });
  ({ target, source } = await applySave(
    value.repository,
    target,
    source,
    deleteOperation,
    { editRevision: 3 },
  ));
  assert.equal(source, COMMENT_GAP_SOURCE);
  const reopenedAfterDelete = await new ProjectFileRepository({
    projectsRoot: value.projects,
  }).workspace({ sourcePath: target.exactSourcePath });
  assert.equal(reopenedAfterDelete.content, COMMENT_GAP_SOURCE);
});

test("session-local undo and redo carry system-derived identity evidence into Repository saves", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "semantic-history-closure.html", SOURCE);
  const source = await readFile(imported.target.exactSourcePath, "utf8");
  const semanticOperation = operation(source, "deleteElement", {
    target: precondition(source, ids.first),
  }, "sourceop_history_delete_001");
  const applied = applySemanticOperation(createSemanticDocumentState(source), semanticOperation);
  const context = {
    epoch: 1,
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    sourcePath: imported.target.exactSourcePath,
  };
  const session = new SourceHistorySession();
  session.activate(context, applied.previousSourceSha256, null);
  session.record(context, {
    operationId: semanticOperation.operationId,
    kind: "structure",
    editRevision: 1,
    beforeHtml: source,
    afterHtml: applied.html,
    beforeSourceSha256: applied.previousSourceSha256,
    afterSourceSha256: applied.sourceSha256,
    forwardPatches: applied.materialization.sourcePatchResult.patches,
    reversePatches: applied.materialization.sourcePatchResult.inversePlan.patches,
    beforeTarget: null,
    afterTarget: null,
    semanticOperation,
    identityDelta: applied.identityDelta,
  }, 1);

  const firstSave = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: applied.html,
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 1,
    sourceHistoryOperations: session.pendingOperations,
  });
  assert.deepEqual(
    session.acknowledge(context, session.pendingOperations, applied.sourceSha256),
    { status: "accepted-head" },
  );

  const undone = session.apply(context, "undo", applied.html, 2);
  const undoSave = await value.repository.saveWorkingCopy({
    target: firstSave.target,
    html: undone.html,
    expectedSourceSha256: firstSave.currentSha256,
    editRevision: 2,
    sourceHistoryOperations: session.pendingOperations,
  });
  assert.equal(buildSourceIndex(undone.html).byStemmioId.has(ids.first), true);
  assert.equal(session.pendingOperations[0].semanticDirection, "undo");
  assert.deepEqual(
    session.acknowledge(context, session.pendingOperations, undone.sourceSha256),
    { status: "accepted-head" },
  );

  const redone = session.apply(context, "redo", undone.html, 3);
  await value.repository.saveWorkingCopy({
    target: undoSave.target,
    html: redone.html,
    expectedSourceSha256: undoSave.currentSha256,
    editRevision: 3,
    sourceHistoryOperations: session.pendingOperations,
  });
  assert.equal(buildSourceIndex(redone.html).byStemmioId.has(ids.first), false);
  assert.equal(session.pendingOperations[0].semanticDirection, "redo");

  const restartedSession = new SourceHistorySession();
  restartedSession.activate({ ...context, epoch: 2 }, redone.sourceSha256, null);
  assert.equal(restartedSession.capabilities.canUndo, false);
  assert.equal(restartedSession.capabilities.canRedo, false);
});

test("semantic saves retain CAS and crash recovery, and reject unproved or runtime-like identity changes", async (t) => {
  for (const failpoint of ["save-prepared", "save-source-written"]) {
    await t.test(failpoint, async (child) => {
      const value = await fixture(child);
      const imported = await importSource(value, `${failpoint}.html`, SOURCE);
      const source = await readFile(imported.target.exactSourcePath, "utf8");
      const deleting = operation(source, "deleteElement", {
        target: precondition(source, ids.first),
      }, `sourceop_${failpoint.replaceAll("-", "_")}_001`);
      const applied = applySemanticOperation(createSemanticDocumentState(source), deleting);
      const failing = new ProjectFileRepository({
        projectsRoot: value.projects,
        failpoint: async (name) => name === failpoint,
      });
      await assert.rejects(
        failing.saveWorkingCopy({
          target: imported.target,
          html: applied.html,
          expectedSourceSha256: imported.target.sourceSha256,
          editRevision: 1,
          sourceHistoryOperations: [sourceHistoryEvidence(applied, deleting)],
        }),
        (error) => error?.code === "INJECTED_FAILPOINT",
      );
      const reopened = await new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
        sourcePath: imported.target.exactSourcePath,
      });
      assert.equal(
        reopened.content,
        failpoint === "save-prepared" ? source : applied.html,
      );
    });
  }

  const value = await fixture(t);
  const imported = await importSource(value, "semantic-external-guard.html", SOURCE);
  const source = await readFile(imported.target.exactSourcePath, "utf8");
  const runtimeId = "sm1_f0000000000040008000000000000001";
  const runtimeInjected = source.replace(
    "</body>",
    `<canvas data-stemmio-id="${runtimeId}"></canvas></body>`,
  );
  await assert.rejects(
    value.repository.saveWorkingCopy({
      target: imported.target,
      html: runtimeInjected,
      expectedSourceSha256: imported.target.sourceSha256,
      editRevision: 1,
    }),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST",
  );

  const contentOnly = source.replace(">B</p>", " class='changed'>changed</p>");
  const saved = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: contentOnly,
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 1,
  });
  assert.equal(await readFile(saved.target.exactSourcePath, "utf8"), contentOnly);

  const casValue = await fixture(t);
  const casImported = await importSource(casValue, "semantic-cas.html", SOURCE);
  const deleting = operation(SOURCE, "deleteElement", {
    target: precondition(SOURCE, ids.first),
  }, "sourceop_cas_delete_001");
  const applied = applySemanticOperation(createSemanticDocumentState(SOURCE), deleting);
  const external = SOURCE.replace("Managed", "External");
  const conflicting = new ProjectFileRepository({
    projectsRoot: casValue.projects,
    failpoint: async (name) => {
      if (name === "save-prepared") await writeFile(casImported.target.exactSourcePath, external);
      return false;
    },
  });
  await assert.rejects(
    conflicting.saveWorkingCopy({
      target: casImported.target,
      html: applied.html,
      expectedSourceSha256: casImported.target.sourceSha256,
      editRevision: 1,
      sourceHistoryOperations: [sourceHistoryEvidence(applied, deleting)],
    }),
    (error) => error?.code === "WORKING_COPY_CONFLICT",
  );
  assert.equal(await readFile(casImported.target.exactSourcePath, "utf8"), external);
});

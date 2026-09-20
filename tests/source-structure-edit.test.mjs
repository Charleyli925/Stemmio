import test from "node:test";
import assert from "node:assert/strict";

import {
  applySemanticOperation,
  createSemanticDocumentState,
} from "../app/lib/semantic-operation-kernel.js";
import { SourceHistorySession } from "../app/application/source-history-session.js";
import {
  createDeleteElementOperation,
  createDuplicateElementOperation,
  createInsertElementOperation,
  createMoveElementOperation,
  identityFreeSourceElementHtml,
} from "../app/lib/source-structure-edit.js";
import { buildSourceIndex, sourceSha256 } from "../app/lib/source-index.js";
import { createTargetRef } from "../app/lib/target-resolver.js";

const ids = {
  html: "sm1_00000000000040008000000000000001",
  head: "sm1_00000000000040008000000000000002",
  title: "sm1_00000000000040008000000000000003",
  body: "sm1_00000000000040008000000000000004",
  left: "sm1_00000000000040008000000000000005",
  first: "sm1_00000000000040008000000000000006",
  strong: "sm1_00000000000040008000000000000007",
  second: "sm1_00000000000040008000000000000008",
  right: "sm1_00000000000040008000000000000009",
};

const html = `<!doctype html><html data-stemmio-id="${ids.html}"><head data-stemmio-id="${ids.head}"><title data-stemmio-id="${ids.title}">Structure</title></head><body data-stemmio-id="${ids.body}"><section data-stemmio-id="${ids.left}"><p data-stemmio-id="${ids.first}">A <strong data-stemmio-id="${ids.strong}">one</strong></p><p data-stemmio-id="${ids.second}">B</p></section><aside data-stemmio-id="${ids.right}"></aside></body></html>`;

function uuidFactory(...values) {
  let cursor = 0;
  return () => values[cursor++];
}

test("duplicate removes inherited identities and allocates fresh IDs for the full subtree", () => {
  const baseline = createSemanticDocumentState(html);
  const rawCopy = identityFreeSourceElementHtml(html, ids.first);
  assert.doesNotMatch(rawCopy, /data-stemmio-id/u);
  const result = applySemanticOperation(
    baseline,
    createDuplicateElementOperation(html, {
      baseRevision: 0,
      operationId: "op_duplicate_001",
      elementId: ids.first,
    }),
    {
      randomUUID: uuidFactory(
        "10000000-0000-4000-8000-000000000001",
        "10000000-0000-4000-8000-000000000002",
      ),
    },
  );
  const index = buildSourceIndex(result.html);
  assert.equal(result.allocatedElementIds.length, 2);
  assert.equal(index.stemmioIdentity.complete, true);
  assert.equal(index.byStemmioId.get(ids.first)?.textContent, "A one");
  assert.equal(index.byStemmioId.get(result.insertedRootElementId)?.textContent, "A one");
  assert.notEqual(result.insertedRootElementId, ids.first);
});

test("insert, delete and cross-parent move keep source identity authoritative", () => {
  const baseline = createSemanticDocumentState(html);
  const inserted = applySemanticOperation(
    baseline,
    createInsertElementOperation(html, {
      baseRevision: 0,
      operationId: "op_insert_struct",
      parentElementId: ids.left,
      beforeElementId: ids.second,
      html: "<article><em>New</em></article>",
    }),
    {
      randomUUID: uuidFactory(
        "20000000-0000-4000-8000-000000000001",
        "20000000-0000-4000-8000-000000000002",
      ),
    },
  );
  assert.ok(inserted.html.indexOf("<article") < inserted.html.indexOf(`data-stemmio-id="${ids.second}"`));

  const deleted = applySemanticOperation(
    baseline,
    createDeleteElementOperation(html, {
      baseRevision: 0,
      operationId: "op_delete_struct",
      elementId: ids.first,
    }),
  );
  assert.equal(buildSourceIndex(deleted.html).byStemmioId.has(ids.first), false);

  const moved = applySemanticOperation(
    baseline,
    createMoveElementOperation(html, {
      baseRevision: 0,
      operationId: "op_move_cross_parent",
      elementId: ids.second,
      parentElementId: ids.right,
    }),
  );
  const movedIndex = buildSourceIndex(moved.html);
  const target = movedIndex.byStemmioId.get(ids.second);
  const parent = movedIndex.byNodeId.get(target.parentId);
  assert.equal(parent.stemmioId, ids.right);
  assert.equal(target.stemmioId, ids.second);
});

test("same-parent move and delete preserve surrounding authored whitespace exactly", () => {
  const formatted = html.replace(
    `<p data-stemmio-id="${ids.second}">B</p></section>`,
    `<p data-stemmio-id="${ids.second}">B</p>\n  </section>`,
  );
  const baseline = createSemanticDocumentState(formatted);
  const duplicated = applySemanticOperation(
    baseline,
    createDuplicateElementOperation(formatted, {
      baseRevision: 0,
      operationId: "op_duplicate_ws_01",
      elementId: ids.second,
    }),
    { randomUUID: uuidFactory("21000000-0000-4000-8000-000000000001") },
  );
  const moved = applySemanticOperation(
    duplicated.nextState,
    createMoveElementOperation(duplicated.html, {
      baseRevision: duplicated.nextRevision,
      operationId: "op_move_ws_000001",
      elementId: duplicated.insertedRootElementId,
      parentElementId: ids.left,
      beforeElementId: ids.second,
    }),
  );
  const deleted = applySemanticOperation(
    moved.nextState,
    createDeleteElementOperation(moved.html, {
      baseRevision: moved.nextRevision,
      operationId: "op_delete_ws_0001",
      elementId: duplicated.insertedRootElementId,
    }),
  );
  assert.equal(deleted.html, formatted);
});

test("same-parent copy move and delete preserve unrelated authored comments exactly", () => {
  const commentCases = [
    `<section data-stemmio-id="${ids.left}"><!--leading-->\n  <p data-stemmio-id="${ids.first}">A <strong data-stemmio-id="${ids.strong}">one</strong></p>\n  <p data-stemmio-id="${ids.second}">B</p>\n</section>`,
    `<section data-stemmio-id="${ids.left}">\n  <p data-stemmio-id="${ids.first}">A <strong data-stemmio-id="${ids.strong}">one</strong></p>\n  <!--between-->\n  <p data-stemmio-id="${ids.second}">B</p>\n</section>`,
    `<section data-stemmio-id="${ids.left}">\n  <p data-stemmio-id="${ids.first}">A <strong data-stemmio-id="${ids.strong}">one</strong></p>\n  <!--between-->\n  <p data-stemmio-id="${ids.second}">B<!--inside--></p>\n</section>`,
    `<section data-stemmio-id="${ids.left}">\n  <p data-stemmio-id="${ids.first}">A <strong data-stemmio-id="${ids.strong}">one</strong></p>\n  <p data-stemmio-id="${ids.second}">B</p><!--trailing-->\n</section>`,
  ];
  const originalSection = html.slice(
    html.indexOf(`<section data-stemmio-id="${ids.left}">`),
    html.indexOf("</section>") + "</section>".length,
  );
  for (const [caseIndex, section] of commentCases.entries()) {
    const source = html.replace(originalSection, section);
    const duplicated = applySemanticOperation(
      createSemanticDocumentState(source),
      createDuplicateElementOperation(source, {
        baseRevision: 0,
        operationId: `op_duplicate_comment_${caseIndex}`,
        elementId: ids.second,
      }),
      {
        randomUUID: uuidFactory(
          `22000000-0000-4000-8000-00000000000${caseIndex + 1}`,
        ),
      },
    );
    const moved = applySemanticOperation(
      createSemanticDocumentState(duplicated.html, {
        revision: duplicated.nextRevision,
        lineage: duplicated.nextState.lineage,
        insertedElementIds: duplicated.identityDelta.addedElementIds,
      }),
      createMoveElementOperation(duplicated.html, {
        baseRevision: duplicated.nextRevision,
        operationId: `op_move_comment_${caseIndex}`,
        elementId: duplicated.insertedRootElementId,
        parentElementId: ids.left,
        beforeElementId: ids.second,
      }),
    );
    const deleted = applySemanticOperation(
      createSemanticDocumentState(moved.html, {
        revision: moved.nextRevision,
        lineage: moved.nextState.lineage,
        insertedElementIds: duplicated.identityDelta.addedElementIds,
      }),
      createDeleteElementOperation(moved.html, {
        baseRevision: moved.nextRevision,
        operationId: `op_delete_comment_${caseIndex}`,
        elementId: duplicated.insertedRootElementId,
      }),
    );
    assert.equal(deleted.html, source, `comment case ${caseIndex + 1}`);
  }
});

test("cross-parent move refuses a cycle into the moving element's descendants", () => {
  const baseline = createSemanticDocumentState(html);
  assert.throws(() => applySemanticOperation(
    baseline,
    createMoveElementOperation(html, {
      baseRevision: 0,
      operationId: "op_move_cycle",
      elementId: ids.left,
      parentElementId: ids.first,
    }),
  ), (error) => error.code === "SEMANTIC_MOVE_CYCLE");
});

test("structure operation builders reject root deletion and invalid insertion ownership", () => {
  assert.throws(() => createDeleteElementOperation(html, {
    baseRevision: 0,
    elementId: ids.body,
  }), /cannot be deleted/u);
  assert.throws(() => createMoveElementOperation(html, {
    baseRevision: 0,
    elementId: ids.body,
    parentElementId: ids.left,
  }), /cannot be moved/u);
  assert.throws(() => createInsertElementOperation(html, {
    baseRevision: 0,
    parentElementId: ids.left,
    beforeElementId: ids.right,
    html: "<p>Wrong parent</p>",
  }), /direct child/u);
});

test("insert and move fail closed when HTML parsing rejects the requested parent relationship", () => {
  const scriptId = "sm1_00000000000040008000000000000010";
  const unsafeHtml = html.replace(
    `</body>`,
    `<script data-stemmio-id="${scriptId}">void 0</script></body>`,
  );
  const baseline = createSemanticDocumentState(unsafeHtml);
  assert.throws(() => applySemanticOperation(
    baseline,
    createMoveElementOperation(unsafeHtml, {
      baseRevision: 0,
      operationId: "op_move_raw_text",
      elementId: ids.second,
      parentElementId: scriptId,
    }),
  ), (error) => error.code === "SEMANTIC_STRUCTURE_DESTINATION_MISMATCH");
  assert.throws(() => applySemanticOperation(
    baseline,
    createInsertElementOperation(unsafeHtml, {
      baseRevision: 0,
      operationId: "op_insert_raw_text",
      parentElementId: scriptId,
      html: "<p>Unsafe</p>",
    }),
  ), (error) => error.code === "SEMANTIC_STRUCTURE_DESTINATION_MISMATCH");
});

test("accepted structure patches undo and redo inside the bounded open-document history", () => {
  const context = {
    epoch: 1,
    projectId: "project_structure",
    documentId: "document_structure",
    sourcePath: "/tmp/structure.html",
  };
  const baseline = createSemanticDocumentState(html);
  const operation = createDuplicateElementOperation(html, {
    baseRevision: 0,
    operationId: "op_history_struct",
    elementId: ids.first,
  });
  const applied = applySemanticOperation(baseline, operation, {
    randomUUID: uuidFactory(
      "30000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
    ),
  });
  const materialization = applied.materialization.sourcePatchResult;
  const session = new SourceHistorySession();
  session.activate(context, sourceSha256(html), null);
  session.record(context, {
    kind: "structure",
    property: "duplicate",
    beforeSourceSha256: applied.previousSourceSha256,
    afterSourceSha256: applied.sourceSha256,
    forwardPatches: materialization.patches,
    reversePatches: materialization.inversePlan.patches,
    beforeTarget: { id: "target_structure", elementId: ids.first },
    afterTarget: { id: "target_structure", elementId: ids.first },
    semanticOperation: operation,
    identityDelta: applied.identityDelta,
  }, 1);
  const pending = session.pendingOperations;
  assert.deepEqual(
    session.acknowledge(context, pending, applied.sourceSha256),
    { status: "accepted-head" },
  );

  const undone = session.apply(context, "undo", applied.html, 2);
  assert.equal(undone.html, html);
  assert.equal(session.pendingOperations[0].semanticDirection, "undo");
  assert.deepEqual(
    session.pendingOperations[0].identityDelta.addedElementIds,
    applied.identityDelta.removedElementIds,
  );
  assert.deepEqual(
    session.acknowledge(context, session.pendingOperations, sourceSha256(html)),
    { status: "accepted-head" },
  );
  const redone = session.apply(context, "redo", html, 3);
  assert.equal(redone.html, applied.html);
  assert.equal(session.pendingOperations[0].semanticDirection, "redo");
});

test("structure edits keep surviving comment IDs exact and orphan deleted targets", () => {
  const baseline = createSemanticDocumentState(html);
  const trackedComment = createTargetRef(html, buildSourceIndex(html).byStemmioId.get(ids.first), {
    targetId: "comment_target_first",
  });
  const duplicate = applySemanticOperation(
    baseline,
    createDuplicateElementOperation(html, {
      baseRevision: 0,
      operationId: "op_comment_duplicate",
      elementId: ids.first,
    }),
    {
      randomUUID: uuidFactory(
        "40000000-0000-4000-8000-000000000001",
        "40000000-0000-4000-8000-000000000002",
      ),
      trackedTargetRefs: [trackedComment],
    },
  );
  const survivingComment = duplicate.materialization.sourcePatchResult
    .refreshedTrackedTargetRefs[0];
  assert.equal(survivingComment.elementId, ids.first);
  assert.equal(survivingComment.resolution, "exact");

  const deleted = applySemanticOperation(
    baseline,
    createDeleteElementOperation(html, {
      baseRevision: 0,
      operationId: "op_comment_delete",
      elementId: ids.first,
    }),
  );
  const deletedTarget = deleted.materialization.sourcePatchResult.refreshedTargetRefs[0];
  assert.equal(deletedTarget.elementId, ids.first);
  assert.equal(deletedTarget.resolution, "orphaned");
});

import assert from "node:assert/strict";
import {
  lstat,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import { sha256 } from "../bridge/lifecycle-core.mjs";
import { MAX_HTML_BYTES } from "../bridge/project-file-repository/constants.mjs";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";
import {
  inspectSourceElementIdentity,
  materializeIdentityPreservingSave,
  materializeSourceElementIdentity,
  sourceElementIdentityBindingSha256,
} from "../bridge/project-file-repository/working-copy.mjs";
import {
  fixture,
  importSource,
  json,
} from "./project-file-repository-harness.mjs";

const RAW_HTML = "<!doctype html>\r\n<html><head><title>旧项目</title></head><body><svg viewBox=\"0 0 10 10\"><rect width=\"10\" height=\"10\"/></svg><template><x-card>内容</x-card></template></body></html>";

function deterministicUuidFactory() {
  let counter = 0;
  return () => {
    counter += 1;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  };
}

function exactSourceHistoryOperation(beforeHtml, afterHtml, {
  startOffset = 0,
  endOffset = beforeHtml.length,
  kind = "reorder",
} = {}) {
  const before = beforeHtml.slice(startOffset, endOffset);
  const after = afterHtml.slice(
    startOffset,
    afterHtml.length - (beforeHtml.length - endOffset),
  );
  return {
    operationId: "sourceop_identity_reorder_001",
    kind,
    editRevision: 1,
    createdAt: "2026-08-29T00:00:00.000Z",
    beforeSourceSha256: sha256(Buffer.from(beforeHtml)),
    afterSourceSha256: sha256(Buffer.from(afterHtml)),
    forwardPatches: [{ startOffset, endOffset, before, after, kind: "replace" }],
    reversePatches: [{
      startOffset,
      endOffset: startOffset + after.length,
      before: after,
      after: before,
      kind: "replace",
    }],
    beforeTarget: null,
    afterTarget: null,
  };
}

function fileIdentity(information) {
  return {
    device: String(information.dev),
    inode: String(information.ino),
    birthtimeMs: Number(information.birthtimeMs || 0),
  };
}

async function rewriteAsLegacyWorkingCopy(imported, html) {
  const controlRoot = path.join(imported.target.projectRootPath, ".stemmio");
  const manifestPath = path.join(controlRoot, "manifest.json");
  const manifest = await json(manifestPath);
  const workingCopy = manifest.workingCopies.find(
    (entry) => entry.workingCopyId === imported.target.workingCopyId,
  );
  assert.ok(workingCopy);
  await writeFile(imported.target.exactSourcePath, html, "utf8");
  workingCopy.fileIdentity = fileIdentity(await lstat(imported.target.exactSourcePath));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const statePath = path.join(controlRoot, workingCopy.stateRelativePath);
  const state = await json(statePath);
  const sourceSha256 = sha256(Buffer.from(html, "utf8"));
  state.currentSha256 = sourceSha256;
  state.differsFromBase = sourceSha256 !== state.baseSha256;
  state.saveState = "saved";
  delete state.sourceElementIdentitySchemaVersion;
  delete state.sourceElementIdentityBindingSha256;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return { controlRoot, manifestPath, statePath, workingCopy, sourceSha256 };
}

async function assertMigrationSchema(value) {
  const schema = JSON.parse(await readFile(
    new URL("../schemas/source-element-identity-migration.v1.schema.json", import.meta.url),
    "utf8",
  ));
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  ajv.addFormat(
    "date-time",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u,
  );
  const validate = ajv.compile(schema);
  assert.equal(
    validate(value),
    true,
    ajv.errorsText(validate.errors, { separator: "\n" }),
  );
}

test("identity materialization preserves authored bytes outside start-tag insertions", () => {
  const existingId = "sm1_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa";
  const source = RAW_HTML.replace("<body>", `<body data-stemmio-id=\"${existingId}\">`);
  const materialized = materializeSourceElementIdentity(source, {
    randomUUIDFactory: deterministicUuidFactory(),
  });

  assert.equal(materialized.changed, true);
  assert.equal(materialized.html.startsWith("<!doctype html>\r\n"), true);
  assert.equal(materialized.html.includes(`<body data-stemmio-id=\"${existingId}\">`), true);
  assert.equal(materialized.identity.complete, true);
  assert.equal(
    materialized.identity.totalElementCount,
    materialized.identity.identifiedElementCount,
  );
  assert.equal(materialized.identity.totalElementCount, 8);
  assert.equal(materialized.addedElementCount, 7);
  assert.equal(
    materialized.html.replace(/ data-stemmio-id="sm1_[a-f0-9]{32}"/gu, ""),
    source.replace(` data-stemmio-id=\"${existingId}\"`, ""),
  );

  const repeated = materializeSourceElementIdentity(materialized.html, {
    randomUUIDFactory: () => {
      throw new Error("idempotent materialization must not allocate");
    },
  });
  assert.equal(repeated.changed, false);
  assert.equal(repeated.html, materialized.html);
});

test("UTF-8 BOM Working Copies still receive html, head and body identities", () => {
  const source = `\uFEFF${RAW_HTML}`;
  const materialized = materializeSourceElementIdentity(source, {
    randomUUIDFactory: deterministicUuidFactory(),
  });
  assert.equal(materialized.changed, true);
  assert.equal(materialized.html.startsWith("\uFEFF"), true);
  assert.match(materialized.html, /<html data-stemmio-id="sm1_[a-f0-9]{32}">/u);
  assert.match(materialized.html, /<head data-stemmio-id="sm1_[a-f0-9]{32}">/u);
  assert.match(materialized.html, /<body data-stemmio-id="sm1_[a-f0-9]{32}">/u);
  assert.equal(materialized.identity.complete, true);
  assert.equal(materialized.identity.totalElementCount, 8);
});

test("identity materialization refuses malformed and duplicate authored identities", () => {
  const duplicate = "sm1_bbbbbbbbbbbb4bbb9bbbbbbbbbbbbbbb";
  const invalid = RAW_HTML
    .replace("<html>", `<html data-stemmio-id=\"${duplicate}\">`)
    .replace("<head>", `<head data-stemmio-id=\"${duplicate}\">`);
  assert.throws(
    () => materializeSourceElementIdentity(invalid),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_INVALID"
      && error.details.issues.some((issue) => issue.code === "STEMMIO_ID_DUPLICATE_VALUE"),
  );
  assert.throws(
    () => materializeSourceElementIdentity(
      RAW_HTML.replace("<html>", "<html data-stemmio-id=\"customer-value\">"),
    ),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_INVALID"
      && error.details.issues.some((issue) => issue.code === "STEMMIO_ID_INVALID_FORMAT"),
  );
  assert.throws(
    () => materializeSourceElementIdentity(
      RAW_HTML.replace(
        "<html>",
        "<html data-stemmio-id=\"sm1_1111111111114111811111111111111&#x31;\">",
      ),
    ),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_INVALID",
  );
});

test("an identity-preserving save requires semantic evidence even for pre-identified additions", () => {
  const current = materializeSourceElementIdentity(RAW_HTML, {
    randomUUIDFactory: deterministicUuidFactory(),
  }).html;
  const newId = "sm1_99999999999949998999999999999999";
  const next = current.replace(
    "</body>",
    `<br data-stemmio-id="${newId}"></body>`,
  );
  assert.throws(
    () => materializeIdentityPreservingSave(current, next),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error.details.addedIds.includes(newId),
  );
  assert.throws(
    () => materializeIdentityPreservingSave(current, next, {
      sourceHistoryOperations: [exactSourceHistoryOperation(current, next, {
        kind: "structure",
      })],
    }),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error.details.addedIds.includes(newId),
  );
  const unidentifiedAddition = current.replace("</body>", "<br></body>");
  assert.throws(
    () => materializeIdentityPreservingSave(current, unidentifiedAddition),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error.details.missingElementCount === 1,
  );
  const removedIdentity = next.replace(/ data-stemmio-id="sm1_[a-f0-9]{32}"/u, "");
  assert.throws(
    () => materializeIdentityPreservingSave(current, removedIdentity),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error.details.lostIds.length === 1,
  );
});

test("fresh sibling identities cannot disguise a retained ID transplant", () => {
  const current = materializeSourceElementIdentity(
    "<!doctype html><html><head><title>IDs</title></head><body><p>first</p><p>second</p></body></html>",
    { randomUUIDFactory: deterministicUuidFactory() },
  ).html;
  const [firstId, secondId] = inspectSourceElementIdentity(current).elements
    .filter((element) => element.tagName === "p")
    .map((element) => element.stemmioId);
  const freshId = "sm1_99999999999949998999999999999999";
  const next = current.replace(
    `<p data-stemmio-id="${firstId}">first</p><p data-stemmio-id="${secondId}">second</p>`,
    `<p data-stemmio-id="${freshId}">first</p>`
      + `<p data-stemmio-id="${firstId}">new</p>`
      + `<p data-stemmio-id="${secondId}">second</p>`,
  );
  assert.throws(
    () => materializeIdentityPreservingSave(current, next),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error.details.addedIds.includes(freshId),
  );
  assert.throws(
    () => materializeIdentityPreservingSave(current, next, {
      sourceHistoryOperations: [exactSourceHistoryOperation(current, next)],
    }),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error.details.addedIds.includes(freshId),
  );
});

test("the binding seal ignores content but detects identity structure drift", () => {
  const current = materializeSourceElementIdentity(
    "<!doctype html><html><head><title>Seal</title></head><body><p>first</p><p>second</p></body></html>",
    { randomUUIDFactory: deterministicUuidFactory() },
  ).html;
  const currentSeal = sourceElementIdentityBindingSha256(current);
  assert.equal(
    sourceElementIdentityBindingSha256(
      current.replace(">first</p>", ' style="color:red">changed</p>'),
    ),
    currentSeal,
  );
  const paragraphIds = inspectSourceElementIdentity(current).elements
    .filter((element) => element.tagName === "p")
    .map((element) => element.stemmioId);
  const swapped = current
    .replace(paragraphIds[0], "__stemmio_first_id__")
    .replace(paragraphIds[1], paragraphIds[0])
    .replace("__stemmio_first_id__", paragraphIds[1]);
  assert.notEqual(sourceElementIdentityBindingSha256(swapped), currentSeal);
});

test("identity materialization rejects output above the managed HTML limit", () => {
  const shell = "<!doctype html><html><head><title>Large</title></head><body><i></i></body></html>";
  const padding = "x".repeat(MAX_HTML_BYTES - Buffer.byteLength(shell, "utf8"));
  const source = shell.replace("<i></i>", `<i></i><!--${padding.slice(7)}-->`);
  assert.ok(Buffer.byteLength(source, "utf8") <= MAX_HTML_BYTES);
  assert.throws(
    () => materializeSourceElementIdentity(source, {
      randomUUIDFactory: deterministicUuidFactory(),
    }),
    (error) => error?.code === "SOURCE_TOO_LARGE"
      && error.details.maxByteLength === MAX_HTML_BYTES,
  );
});

test("an identity-preserving save rejects swapped and transplanted IDs", () => {
  const current = materializeSourceElementIdentity(
    "<!doctype html><html><head><title>IDs</title></head><body><p>first</p><p>second</p></body></html>",
    { randomUUIDFactory: deterministicUuidFactory() },
  ).html;
  const paragraphIds = inspectSourceElementIdentity(current).elements
    .filter((element) => element.tagName === "p")
    .map((element) => element.stemmioId);
  assert.equal(paragraphIds.length, 2);
  const [firstId, secondId] = paragraphIds;
  const swapped = current
    .replace(firstId, "__stemmio_first_id__")
    .replace(secondId, firstId)
    .replace("__stemmio_first_id__", secondId);
  assert.throws(
    () => materializeIdentityPreservingSave(current, swapped),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error.details.bindingIssues.some(
        (issue) => issue.code === "STEMMIO_ID_SOURCE_ORDER_CHANGED",
      ),
  );
  assert.throws(
    () => materializeIdentityPreservingSave(current, swapped, {
      sourceHistoryOperations: [exactSourceHistoryOperation(current, swapped)],
    }),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error.details.operationId === "sourceop_identity_reorder_001",
  );

  const transplanted = current
    .replace(` data-stemmio-id="${firstId}"`, "")
    .replace(
      `<p data-stemmio-id="${secondId}">second</p>`,
      `<p data-stemmio-id="${firstId}">new</p>`
        + `<p data-stemmio-id="${secondId}">second</p>`,
    );
  assert.throws(
    () => materializeIdentityPreservingSave(current, transplanted),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error.details.lostIds.length === 0
      && error.details.missingElementCount === 1,
  );
});

test("an exact source-history reorder cannot authorize topology changes without semantic evidence", () => {
  const current = materializeSourceElementIdentity(
    "<!doctype html><html><head><title>Move</title></head><body><p>first</p><p>second</p></body></html>",
    { randomUUIDFactory: deterministicUuidFactory() },
  ).html;
  const paragraphs = [...current.matchAll(
    /<p data-stemmio-id="sm1_[0-9a-f]{32}">[^<]+<\/p>/gu,
  )].map((match) => match[0]);
  assert.equal(paragraphs.length, 2);
  const beforeBlock = paragraphs.join("");
  const afterBlock = [...paragraphs].reverse().join("");
  const startOffset = current.indexOf(beforeBlock);
  const moved = current.slice(0, startOffset)
    + afterBlock
    + current.slice(startOffset + beforeBlock.length);
  const operation = exactSourceHistoryOperation(current, moved, {
    startOffset,
    endOffset: startOffset + beforeBlock.length,
  });

  assert.throws(
    () => materializeIdentityPreservingSave(current, moved, {
      sourceHistoryOperations: [operation],
    }),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error.details.operationId === operation.operationId,
  );
});

test("a new import writes identified Working Copy bytes without changing the external file or V1", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "new-project.html", RAW_HTML);
  const managed = await readFile(imported.target.exactSourcePath, "utf8");
  const manifest = await json(path.join(imported.target.projectRootPath, ".stemmio", "manifest.json"));
  const workingCopy = manifest.workingCopies[0];
  const state = await json(path.join(
    imported.target.projectRootPath,
    ".stemmio",
    workingCopy.stateRelativePath,
  ));
  const snapshot = await readFile(path.join(
    imported.target.projectRootPath,
    ".stemmio",
    manifest.versions[0].snapshotRelativePath,
  ), "utf8");

  assert.equal(await readFile(imported.sourcePath, "utf8"), RAW_HTML);
  assert.equal(snapshot, RAW_HTML);
  assert.equal(manifest.versions[0].contentSha256, sha256(Buffer.from(RAW_HTML)));
  assert.equal(inspectSourceElementIdentity(managed).complete, true);
  assert.equal(imported.importSourceSha256, sha256(Buffer.from(RAW_HTML)));
  assert.equal(imported.target.sourceSha256, sha256(Buffer.from(managed)));
  assert.equal(state.baseSha256, sha256(Buffer.from(RAW_HTML)));
  assert.equal(state.currentSha256, imported.target.sourceSha256);
  assert.equal(state.differsFromBase, true);
  assert.equal(state.sourceElementIdentitySchemaVersion, 1);
});

test("an ordinary load rejects a Working Copy missing required element identities", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "legacy.html", RAW_HTML);
  const legacy = await rewriteAsLegacyWorkingCopy(imported, RAW_HTML);

  await assert.rejects(
    value.repository.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_UNSUPPORTED",
  );
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), RAW_HTML);
  const state = await json(legacy.statePath);
  assert.equal(state.sourceElementIdentitySchemaVersion, undefined);
  assert.equal(
    (await readdir(path.join(legacy.controlRoot, "transactions")))
      .filter((name) => name.startsWith("identity_")).length,
    0,
  );
});

test("explicit external adoption may materialize identities with a current operation", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "adopt-existing.html", RAW_HTML);
  await writeFile(imported.target.exactSourcePath, RAW_HTML, "utf8");
  const acceptedSourceSha256 = sha256(Buffer.from(RAW_HTML));
  const result = await value.repository.forceUnlockWorkingCopy({
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    sourcePath: imported.target.exactSourcePath,
    expectedSourceSha256: acceptedSourceSha256,
    operationId: "force_unlock_identity_0001",
  });
  assert.equal(result.status, "force-unlocked");
  const workspace = await value.repository.workspace({ sourcePath: imported.target.exactSourcePath });
  assert.equal(inspectSourceElementIdentity(workspace.content).complete, true);
  assert.equal(workspace.workingCopyState.sourceElementIdentitySchemaVersion, 1);
  assert.equal(workspace.workingCopyState.forceUnlockReceipt.status, "completed");
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), workspace.content);
  const controlRoot = path.join(imported.target.projectRootPath, ".stemmio");
  const transactionName = (await readdir(path.join(controlRoot, "transactions"))).find(
    (name) => name.startsWith("identity_") && name.endsWith(".json"),
  );
  assert.ok(transactionName);
  const transaction = await json(path.join(controlRoot, "transactions", transactionName));
  await assertMigrationSchema(transaction);
  assert.equal(transaction.outcome, "migrated");
  assert.equal(transaction.expectedSourceSha256, acceptedSourceSha256);
  assert.notEqual(transaction.expectedSourceSha256, transaction.targetSourceSha256);
});

test("restart rejects an identity recovery record without explicit adoption authority", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "identity-recovery-without-adoption.html", RAW_HTML);
  await writeFile(imported.target.exactSourcePath, RAW_HTML, "utf8");
  const acceptedSourceSha256 = sha256(Buffer.from(RAW_HTML));
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint(name) {
      return name === "identity-migration-prepared";
    },
  });
  await interrupted.initialize();
  await assert.rejects(
    interrupted.forceUnlockWorkingCopy({
      projectId: imported.target.projectId,
      documentId: imported.target.documentId,
      sourcePath: imported.target.exactSourcePath,
      expectedSourceSha256: acceptedSourceSha256,
      operationId: "force_unlock_missing_authority_0001",
    }),
    (error) => error?.code === "INJECTED_FAILPOINT",
  );

  const manifest = await json(path.join(imported.target.projectRootPath, ".stemmio", "manifest.json"));
  const statePath = path.join(
    imported.target.projectRootPath,
    ".stemmio",
    manifest.workingCopies[0].stateRelativePath,
  );
  const state = await json(statePath);
  delete state.forceUnlockReceipt;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const recoveredRepository = new ProjectFileRepository({ projectsRoot: value.projects });
  await recoveredRepository.initialize();
  await assert.rejects(
    recoveredRepository.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error?.code === "UNSUPPORTED_TRANSACTION_FORMAT",
  );
});

test("restart recovery completes every published migration crash window", async (t) => {
  for (const failpoint of [
    "identity-migration-prepared",
    "identity-migration-source-written",
    "identity-migration-metadata-written",
  ]) {
    await t.test(failpoint, async (child) => {
      const value = await fixture(child);
      const imported = await importSource(value, `${failpoint}.html`, RAW_HTML);
      await writeFile(imported.target.exactSourcePath, RAW_HTML, "utf8");
      const acceptedSourceSha256 = sha256(Buffer.from(RAW_HTML));
      const interrupted = new ProjectFileRepository({
        projectsRoot: value.projects,
        failpoint(name) {
          return name === failpoint;
        },
      });
      await interrupted.initialize();
      await assert.rejects(
        interrupted.forceUnlockWorkingCopy({
          projectId: imported.target.projectId,
          documentId: imported.target.documentId,
          sourcePath: imported.target.exactSourcePath,
          expectedSourceSha256: acceptedSourceSha256,
          operationId: `force_unlock_${failpoint.replaceAll("-", "_")}_0001`,
        }),
        (error) => error?.code === "INJECTED_FAILPOINT",
      );

      const recoveredRepository = new ProjectFileRepository({ projectsRoot: value.projects });
      await recoveredRepository.initialize();
      const recovered = await recoveredRepository.workspace({
        sourcePath: imported.target.exactSourcePath,
      });
      assert.equal(inspectSourceElementIdentity(recovered.content).complete, true);
      assert.equal(recovered.workingCopyState.sourceElementIdentitySchemaVersion, 1);
      assert.equal(recovered.workingCopyIdentityMigrated, false);
    });
  }
});

test("restart recovery rejects a migration record whose staged paths do not match its recovery ID", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "tampered-recovery-path.html", RAW_HTML);
  await writeFile(imported.target.exactSourcePath, RAW_HTML, "utf8");
  const acceptedSourceSha256 = sha256(Buffer.from(RAW_HTML));
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint(name) {
      return name === "identity-migration-prepared";
    },
  });
  await interrupted.initialize();
  await assert.rejects(
    interrupted.forceUnlockWorkingCopy({
      projectId: imported.target.projectId,
      documentId: imported.target.documentId,
      sourcePath: imported.target.exactSourcePath,
      expectedSourceSha256: acceptedSourceSha256,
      operationId: "force_unlock_tampered_path_0001",
    }),
    (error) => error?.code === "INJECTED_FAILPOINT",
  );

  const controlRoot = path.join(imported.target.projectRootPath, ".stemmio");
  const transactionName = (await readdir(path.join(controlRoot, "transactions"))).find(
    (name) => name.startsWith("identity_") && name.endsWith(".json"),
  );
  assert.ok(transactionName);
  const transactionPath = path.join(controlRoot, "transactions", transactionName);
  const transaction = await json(transactionPath);
  transaction.previousRelativePath = transaction.nextRelativePath;
  await writeFile(transactionPath, `${JSON.stringify(transaction, null, 2)}\n`, "utf8");

  const recoveredRepository = new ProjectFileRepository({ projectsRoot: value.projects });
  await recoveredRepository.initialize();
  await assert.rejects(
    recoveredRepository.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error?.code === "IDENTITY_MIGRATION_INVALID",
  );
});

test("an already migrated Working Copy fails closed after identity loss", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "identity-loss.html", RAW_HTML);
  const managed = await readFile(imported.target.exactSourcePath, "utf8");
  const damaged = managed.replace(/ data-stemmio-id="sm1_[a-f0-9]{32}"/u, "");
  await writeFile(imported.target.exactSourcePath, damaged, "utf8");

  await assert.rejects(
    value.repository.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error?.code === "WORKING_COPY_CONFLICT"
      && error.details.diskBindingSha256 === null,
  );
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), damaged);
});

test("a normal save cannot publish HTML that drops the adopted identity contract", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-identity-loss.html", RAW_HTML);
  const before = await readFile(imported.target.exactSourcePath, "utf8");

  await assert.rejects(
    value.repository.saveWorkingCopy({
      target: imported.target,
      html: RAW_HTML,
      expectedSourceSha256: imported.target.sourceSha256,
      editRevision: 1,
    }),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST",
  );
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), before);
});

test("a normal save cannot swap identities between source elements", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-identity-swap.html", RAW_HTML);
  const before = await readFile(imported.target.exactSourcePath, "utf8");
  const [firstId, secondId] = [...inspectSourceElementIdentity(before).claimedIds];
  const swapped = before
    .replace(firstId, "__stemmio_first_id__")
    .replace(secondId, firstId)
    .replace("__stemmio_first_id__", secondId);

  await assert.rejects(
    value.repository.saveWorkingCopy({
      target: imported.target,
      html: swapped,
      expectedSourceSha256: imported.target.sourceSha256,
      editRevision: 1,
    }),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error.details.bindingIssues.length > 0,
  );
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), before);
});

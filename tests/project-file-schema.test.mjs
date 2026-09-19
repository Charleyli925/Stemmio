import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";
import { sha256 } from "../bridge/lifecycle-core.mjs";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";

function html(label) {
  return `<!doctype html><html data-stemmio-id="sm1_11111111111141118111111111111111"><head data-stemmio-id="sm1_22222222222242229222222222222222"><title data-stemmio-id="sm1_3333333333334333a333333333333333">${label}</title></head><body data-stemmio-id="sm1_4444444444444444b444444444444444"><h1 data-stemmio-id="sm1_55555555555545558555555555555555">${label}</h1></body></html>`;
}

async function json(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function validate(schemaName, value) {
  const schema = JSON.parse(await readFile(
    new URL(`../schemas/${schemaName}`, import.meta.url),
    "utf8",
  ));
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
  });
  ajv.addFormat(
    "date-time",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u,
  );
  const check = ajv.compile(schema);
  assert.equal(
    check(value),
    true,
    `${schemaName}: ${ajv.errorsText(check.errors, { separator: "\n" })}`,
  );
}

async function validateRejects(schemaName, value) {
  const schema = JSON.parse(await readFile(
    new URL(`../schemas/${schemaName}`, import.meta.url),
    "utf8",
  ));
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
  });
  ajv.addFormat(
    "date-time",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u,
  );
  const check = ajv.compile(schema);
  assert.equal(check(value), false, `${schemaName} unexpectedly accepted invalid runtime authority`);
}

test("v4 schemas accept repository-produced identity, Working Copy, Candidate and Promotion facts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "stemmio-project-file-schema-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "sources");
  const projectsRoot = path.join(root, "projects");
  await mkdir(sourceRoot, { recursive: true });
  const sourcePath = path.join(sourceRoot, "schema.htm");
  const initial = html("V1");
  await writeFile(sourcePath, initial, "utf8");

  const repository = new ProjectFileRepository({ projectsRoot });
  const imported = await repository.importExternal({
    sourcePath,
    expectedSourceSha256: sha256(Buffer.from(initial, "utf8")),
  });
  const controlRoot = path.join(imported.target.projectRootPath, ".stemmio");
  const initialManifest = await json(path.join(controlRoot, "manifest.json"));
  const registry = await json(path.join(
    projectsRoot,
    ".stemmio-registry.json",
  ));
  const initialWorkingCopyState = await json(path.join(
    controlRoot,
    "working-copies",
    "work_ver_0001.json",
  ));
  await Promise.all([
    validate("project-registry.v4.schema.json", registry),
    validate("project-identity.v4.schema.json", await json(path.join(controlRoot, "project.json"))),
    validate("project-manifest.v4.schema.json", initialManifest),
    validate("project-runtime-state.v4.schema.json", await json(path.join(controlRoot, "runtime-state.json"))),
    validate(
      "working-copy-state.v4.schema.json",
      initialWorkingCopyState,
    ),
  ]);
  const missingIdentityBinding = structuredClone(initialWorkingCopyState);
  delete missingIdentityBinding.sourceElementIdentityBindingSha256;
  const bindingWithoutIdentitySchema = structuredClone(initialWorkingCopyState);
  delete bindingWithoutIdentitySchema.sourceElementIdentitySchemaVersion;
  await Promise.all([
    validateRejects("working-copy-state.v4.schema.json", missingIdentityBinding),
    validateRejects("working-copy-state.v4.schema.json", bindingWithoutIdentitySchema),
  ]);
  const unsupportedRuntime = await json(path.join(
    controlRoot,
    "runtime-state.json",
  ));
  unsupportedRuntime.historyActivation = {
    operationId: "history_activation_legacy",
    state: "desktop-pending",
  };
  await validateRejects(
    "project-runtime-state.v4.schema.json",
    unsupportedRuntime,
  );
  const terminalDisplayRuntime = await json(path.join(
    controlRoot,
    "runtime-state.json",
  ));
  terminalDisplayRuntime.lastAiTask = {
    requestId: "req_schema_terminal",
    attemptId: "attempt_001",
    candidateId: "candidate_schema_terminal_0001",
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    sourceWorkingCopyId: imported.target.workingCopyId,
    expectedSourceSha256: imported.target.sourceSha256,
    inputManifestSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    status: "no-change",
    completedAt: "2026-08-15T00:00:00.000Z",
  };
  await validate("project-runtime-state.v4.schema.json", terminalDisplayRuntime);
  const malformedTerminalDisplay = structuredClone(terminalDisplayRuntime);
  malformedTerminalDisplay.lastAiTask.status = "processing";
  await validateRejects("project-runtime-state.v4.schema.json", malformedTerminalDisplay);
  const missingImportSourceHash = structuredClone(registry);
  delete missingImportSourceHash.projects[imported.target.projectId].importSourceSha256;
  await validateRejects("project-registry.v4.schema.json", missingImportSourceHash);

  const candidate = await repository.createCandidate({
    target: imported.target,
    requestId: "req_schema",
    candidateId: "candidate_schema_0001",
    html: html("V2"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const candidatePath = path.join(controlRoot, "requests", "req_schema", "candidate.json");
  const candidateRuntime = await json(path.join(controlRoot, "runtime-state.json"));
  const candidateRecord = await json(candidatePath);
  await Promise.all([
    validate("candidate.v4.schema.json", candidateRecord),
    validate("project-runtime-state.v4.schema.json", candidateRuntime),
  ]);
  const oversizedImpactSample = structuredClone(candidateRecord);
  oversizedImpactSample.assessment.changedElementIdSample = Array.from(
    { length: 101 },
    () => "sm1_55555555555545558555555555555555",
  );
  const mixedImpactEvidence = structuredClone(candidateRecord);
  mixedImpactEvidence.assessment.changedStableElementIds = [];
  await Promise.all([
    validateRejects("candidate.v4.schema.json", oversizedImpactSample),
    validateRejects("candidate.v4.schema.json", mixedImpactEvidence),
  ]);
  assert.equal(candidateRecord.identityReport.status, "verified");
  assert.equal(
    candidateRecord.identityReport.submittedOutputSha256,
    candidateRecord.submittedOutputSha256,
  );
  assert.equal(candidateRecord.identityReport.outputSha256, candidateRecord.outputSha256);
  const legacyCandidateWithoutIdentityEvidence = structuredClone(candidateRecord);
  delete legacyCandidateWithoutIdentityEvidence.submittedOutputSha256;
  delete legacyCandidateWithoutIdentityEvidence.identityReport;
  await validateRejects("candidate.v4.schema.json", legacyCandidateWithoutIdentityEvidence);
  assert.match(candidateRuntime.activeRequest.candidateOutputSha256, /^sha256:[a-f0-9]{64}$/u);
  assert.match(candidateRuntime.activeRequest.candidateRecordSha256, /^sha256:[a-f0-9]{64}$/u);
  const missingCandidateSeal = structuredClone(candidateRuntime);
  delete missingCandidateSeal.activeRequest.candidateOutputSha256;
  const wrongCandidateSealType = structuredClone(candidateRuntime);
  wrongCandidateSealType.activeRequest.candidateRecordSha256 = 42;
  const malformedCandidateSeal = structuredClone(candidateRuntime);
  malformedCandidateSeal.activeRequest.candidateOutputSha256 = "sha256:not-a-digest";
  const missingPendingReviewSeal = structuredClone(candidateRuntime);
  missingPendingReviewSeal.activeRequest.candidateOutputSha256 = null;
  const missingWorkingCopyAnchor = structuredClone(candidateRuntime);
  missingWorkingCopyAnchor.activeWorkingCopyId = null;
  const staleCandidateWithoutRequest = structuredClone(candidateRuntime);
  staleCandidateWithoutRequest.activeRequest = null;
  const activeRequestWithTerminalDisplay = structuredClone(candidateRuntime);
  activeRequestWithTerminalDisplay.lastAiTask = terminalDisplayRuntime.lastAiTask;
  await Promise.all([
    validateRejects("project-runtime-state.v4.schema.json", missingCandidateSeal),
    validateRejects("project-runtime-state.v4.schema.json", wrongCandidateSealType),
    validateRejects("project-runtime-state.v4.schema.json", malformedCandidateSeal),
    validateRejects("project-runtime-state.v4.schema.json", missingPendingReviewSeal),
    validateRejects("project-runtime-state.v4.schema.json", missingWorkingCopyAnchor),
    validateRejects("project-runtime-state.v4.schema.json", staleCandidateWithoutRequest),
    validateRejects("project-runtime-state.v4.schema.json", activeRequestWithTerminalDisplay),
  ]);

  const promoted = await repository.promoteCandidate({
    target: imported.target,
    candidateId: candidate.candidate.candidateId,
    decisionOperationId: `promote_${candidate.candidate.candidateId}`,
  });
  const transaction = await json(path.join(
    controlRoot,
    "transactions",
    `current_promote_${candidate.candidate.candidateId}`,
    "transaction.json",
  ));
  const missingAfterHash = structuredClone(transaction);
  delete missingAfterHash.afterSha256;
  await Promise.all([
    validate("candidate.v4.schema.json", await json(candidatePath)),
    validate("project-manifest.v4.schema.json", await json(path.join(controlRoot, "manifest.json"))),
    validate("project-runtime-state.v4.schema.json", await json(path.join(controlRoot, "runtime-state.json"))),
    validate(
      "working-copy-state.v4.schema.json",
      await json(path.join(controlRoot, "working-copies", "work_ver_0001.json")),
    ),
    validate(
      "current-version-transaction.v1.schema.json",
      transaction,
    ),
    validateRejects(
      "current-version-transaction.v1.schema.json",
      missingAfterHash,
    ),
  ]);
  assert.equal(promoted.version.versionId, "ver_0002");

  // The Runtime is forward compatible per level. Unknown root members remain
  // readable, while authored activeRequest and lastAiTask fields stay strict.
  const futureRuntime = await json(path.join(controlRoot, "runtime-state.json"));
  futureRuntime.ownerAccountId = "account_future";
  await validate("project-runtime-state.v4.schema.json", futureRuntime);

  // ADR 0022 forbids one specific member, a project-wide `fileNaming`; ADR 0057
  // requires every other added member to survive. The schema states the first
  // prohibition directly instead of rejecting anything it has not seen before,
  // so both assertions below must hold at once.
  const invalidManifest = { ...initialManifest, fileNaming: { stem: "legacy" } };
  const schema = JSON.parse(await readFile(
    new URL("../schemas/project-manifest.v4.schema.json", import.meta.url),
    "utf8",
  ));
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  ajv.addFormat(
    "date-time",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u,
  );
  const check = ajv.compile(schema);
  assert.equal(check(invalidManifest), false);
  const nestedWorkingCopy = structuredClone(initialManifest);
  nestedWorkingCopy.workingCopies[0].sourceRelativePath = "nested/schema-V1.htm";
  assert.equal(check(nestedWorkingCopy), false);

  const futureManifest = structuredClone(initialManifest);
  futureManifest.ownerAccountId = "account_future";
  futureManifest.versions[0].provenance = { seq: 1 };
  futureManifest.workingCopies[0].provenance = { seq: 2 };
  assert.equal(check(futureManifest), true);

  // fileIdentity is authored from a fresh stat on every save, so it cannot
  // carry an added member and stays strict.
  const futureFileIdentity = structuredClone(initialManifest);
  futureFileIdentity.workingCopies[0].fileIdentity.futureIdentity = "next";
  assert.equal(check(futureFileIdentity), false);
});

test("v4 schemas validate manual historical provenance without rewriting legacy Versions", async (t) => {
  const { fixture, importSource } = await import("./project-file-repository-harness.mjs");
  const value = await fixture(t);
  const { target } = await importSource(value);
  const created = await value.repository.createVersionFromHistory({ target, versionId: "ver_0001", operationId: "history_schema_0001",
    expectedSourceSha256: target.sourceSha256, expectedSnapshotSha256: target.sourceSha256 });
  const workspace = await value.repository.workspace({ sourcePath: created.sourcePath });
  await validate("project-manifest.v4.schema.json", workspace.manifest);
  await validate("project-runtime-state.v4.schema.json", workspace.runtime);
  const missingOrigin = structuredClone(workspace.manifest);
  delete missingOrigin.versions[1].sourceOperationId;
  await validateRejects("project-manifest.v4.schema.json", missingOrigin);
  const fakeAi = structuredClone(workspace.manifest);
  fakeAi.versions[1].sourceRequestId = "req_fake_ai";
  await validateRejects("project-manifest.v4.schema.json", fakeAi);
});

test("current draft disk schemas validate one member, local snapshots and recovery records", async (t) => {
  const { fixture, importSource } = await import("./project-file-repository-harness.mjs");
  const value = await fixture(t); const { target } = await importSource(value);
  await value.repository.saveWorkingCopy({ target, html: html("local"), expectedSourceSha256: target.sourceSha256 });
  const active = (await value.repository.resolveRegisteredProjectOpenTarget({ projectId: target.projectId })).target;
  const saved = await value.repository.createVersionFromCurrent({ target: active, operationId: "schema_local_snapshot", expectedSourceSha256: active.sourceSha256 });
  await validate("current-version-transaction.v1.schema.json", await json(path.join(target.projectRootPath, ".stemmio/transactions/current_schema_local_snapshot/transaction.json")));
  const local = (await value.repository.resolveRegisteredProjectOpenTarget({ projectId: target.projectId })).target;
  await value.repository.createVersionFromHistory({ target: local, versionId: "ver_0001", operationId: "schema_current_replace", expectedSourceSha256: local.sourceSha256, expectedSnapshotSha256: target.sourceSha256 });
  const records = await value.repository.listPreservedDrafts({ projectId: target.projectId });
  await validate("preserved-draft.v1.schema.json", await json(path.join(target.projectRootPath, ".stemmio/recovery/preserved-drafts", records[0].recoveryId, "record.json")));
  const manifest = await json(path.join(target.projectRootPath, ".stemmio/manifest.json"));
  await validate("project-manifest.v4.schema.json", manifest);
  assert.equal(manifest.versions[1].sourceType, "local-save");
  const extra = structuredClone(manifest); extra.workingCopies.push(structuredClone(extra.workingCopies[0]));
  await validateRejects("project-manifest.v4.schema.json", extra);
  const unknown = structuredClone(manifest); unknown.currentDraftSchemaVersion = "2.0.0";
  await validateRejects("project-manifest.v4.schema.json", unknown);
  assert.equal(saved.workingCopyId, target.workingCopyId);
});

test("manifest rejects retired Working Copy members and missing current marker", async (t) => {
  const { fixture, importSource } = await import("./project-file-repository-harness.mjs");
  const { assertManifest } = await import("../bridge/project-file-repository/registry.mjs");
  const value = await fixture(t);
  const { target } = await importSource(value);
  const manifestPath = path.join(target.projectRootPath, ".stemmio/manifest.json");
  const project = await json(path.join(target.projectRootPath, ".stemmio/project.json"));
  const manifest = await json(manifestPath);
  for (const invalid of [
    { ...structuredClone(manifest), retiredWorkingCopies: [] },
    (() => { const copy = structuredClone(manifest); delete copy.currentDraftSchemaVersion; return copy; })(),
  ]) {
    await validateRejects("project-manifest.v4.schema.json", invalid);
    assert.throws(() => assertManifest(invalid, project));
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  decodeDraftAuditChange,
  decodeVersionAuditChange,
} from "../app/workbench/version-compatibility-decoder.js";
import {
  assessHtmlCandidate,
} from "../bridge/candidate-assessment.mjs";
import {
  decodeCandidateAssessmentRecord,
  decodeHistoricalCandidateAssessment,
} from "../bridge/candidate-assessment-decoder.mjs";
import {
  decodeDraftCommandOperationId,
} from "../bridge/draft-command-decoder.mjs";
import {
  applyDraftCommand,
} from "../bridge/draft-service.mjs";
import {
  decodeDirectEditIdentity,
} from "../shared/direct-edit-compatibility.mjs";
import {
  createDraftOperationId,
  normalizeAuthoritativeDraft,
  operationWasApplied,
} from "../shared/draft-aggregate.mjs";

async function fixture(relativePath) {
  const value = await readFile(
    new URL(`../fixtures/${relativePath}`, import.meta.url),
    "utf8",
  );
  return JSON.parse(value);
}

async function fixtureBuffer(relativePath) {
  return readFile(new URL(`../fixtures/${relativePath}`, import.meta.url));
}

const randomUUID = () => "compatibility_decoder_0001";

test("legacy Draft commands without operationId fail closed", async () => {
  const legacyCommand = await fixture(
    "compatibility-decoders/draft-command.missing-operation-id.json",
  );
  assert.throws(
    () => applyDraftCommand({
      draftRevision: legacyCommand.expectedDraftRevision,
    }, legacyCommand, { randomUUID }),
    (error) => error.code === "INVALID_DRAFT_OPERATION_ID",
  );
  assert.throws(
    () => decodeDraftCommandOperationId(undefined),
    /operationId/u,
  );
  assert.throws(
    () => decodeDraftCommandOperationId("not-a-draft-operation"),
    /operationId/u,
  );
  assert.match(createDraftOperationId(randomUUID), /^draftop_(?!legacy_)/u);

  const persistedDraft = await fixture(
    "compatibility-decoders/draft-authority.current.json",
  );
  const authority = normalizeAuthoritativeDraft(persistedDraft);
  assert.equal(authority.changeEvents.length, 1);
  assert.equal(
    operationWasApplied(authority, "draftop_legacy_000000000001"),
    true,
  );
});

test("direct-edit aliases fail closed and current records keep one identity pair", async () => {
  const legacy = await fixture(
    "compatibility-decoders/version-edit-event.legacy-aliases.json",
  );
  assert.throws(
    () => decodeDirectEditIdentity(legacy),
    (error) => error.code === "UNKNOWN_DIRECT_EDIT_FIELD",
  );
  assert.equal(decodeVersionAuditChange(legacy), null);
  const currentArchive = await fixture("v3/annotation-records.frozen.json");
  const current = decodeVersionAuditChange(currentArchive.editEvents[0]);
  assert.equal(current?.basedOnVersionId, "ver_0005");
  assert.equal(current?.revision, 41);
  assert.equal("baseVersionId" in current, false);
  assert.equal("capturedRevision" in current, false);

  assert.throws(
    () => decodeDirectEditIdentity({ ...legacy, unknown: true }),
    (error) => error.code === "UNKNOWN_DIRECT_EDIT_FIELD",
  );

  const draftAuthority = await fixture(
    "compatibility-decoders/draft-authority.current.json",
  );
  const draftEvent = draftAuthority.changeEvents[0];
  assert.equal(decodeVersionAuditChange(draftEvent), null);
  assert.deepEqual(
    decodeDraftAuditChange(draftEvent),
    {
      eventId: "change_fixture_current",
      createdAt: "2026-08-04T07:45:14.371Z",
      kind: "text",
      target: draftEvent.target,
      before: "旧标题",
      after: "新标题",
      basedOnVersionId: "ver_0004",
      revision: 4,
    },
  );
});

test("retired Developer Preview candidate-assessment shapes fail closed", async () => {
  const [current, retired, baseBuffer, outputBuffer] = await Promise.all([
    fixture("candidate-assessment-compat/candidate-assessment.pre-executable-dev.json"),
    fixture("candidate-assessment-compat/candidate-assessment.retired-executable-dev.json"),
    fixtureBuffer("candidate-assessment-compat/base.html"),
    fixtureBuffer("candidate-assessment-compat/output.html"),
  ]);
  const canonicalCurrent = decodeCandidateAssessmentRecord(current);
  const historical = decodeHistoricalCandidateAssessment(current, {
    baseBuffer,
    outputBuffer,
  });
  assert.deepEqual(
    historical,
    {
      ...canonicalCurrent,
      status: "attention",
      issueCodes: ["AUTHORED_SCRIPT_CHANGED"],
    },
  );
  assert.equal(current.status, "ready");
  assert.deepEqual(current.issueCodes, []);
  assert.throws(
    () => decodeCandidateAssessmentRecord(retired),
    (error) => error.code === "CANDIDATE_ASSESSMENT_INVALID",
  );
  assert.equal("executable" in canonicalCurrent, false);
  assert.equal(
    "executableSurfaceUnchanged" in canonicalCurrent.health,
    false,
  );
  assert.equal(
    "executable" in assessHtmlCandidate({
      baseHtml: baseBuffer.toString("utf8"),
      outputHtml: outputBuffer.toString("utf8"),
    }),
    false,
  );

  assert.throws(
    () => decodeCandidateAssessmentRecord({ ...current, unknown: true }),
    (error) => error.code === "CANDIDATE_ASSESSMENT_INVALID",
  );
  const halfRetired = structuredClone(current);
  halfRetired.health.executableSurfaceUnchanged = true;
  assert.throws(
    () => decodeCandidateAssessmentRecord(halfRetired),
    (error) => error.code === "CANDIDATE_ASSESSMENT_INVALID",
  );
  assert.throws(
    () => decodeHistoricalCandidateAssessment({
      ...current,
      status: "attention",
      issueCodes: ["PAGE_CONTINUITY_UNCERTAIN"],
    }, { baseBuffer, outputBuffer }),
    (error) => error.code === "CANDIDATE_ASSESSMENT_INVALID",
  );
});

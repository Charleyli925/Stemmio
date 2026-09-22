import { isDeepStrictEqual } from "node:util";

import {
  IMPACT_SAMPLE_LIMIT,
  assessHtmlCandidate,
} from "./candidate-assessment.mjs";
import {
  assertSchemaVersion,
  AUXILIARY_SCHEMA_VERSION,
  comparisonSha256,
  LifecycleError,
  sha256,
} from "./lifecycle-core.mjs";
import {
  isValidStemmioElementId,
} from "../shared/stemmio-element-identity.mjs";

const ROOT_FIELDS = new Set([
  "schemaVersion",
  "status",
  "projectId",
  "documentId",
  "requestId",
  "attemptId",
  "candidateVersionId",
  "baseSha256",
  "outputSha256",
  "baseComparisonSha256",
  "outputComparisonSha256",
  "issueCodes",
  "health",
  "continuity",
  "changedElementCount",
  "outsideTargetCount",
  "changedElementIdSample",
  "outsideTargetElementIdSample",
  "truncated",
  "requestedTargetCount",
  "assessedAt",
]);
const REQUIRED_ROOT_FIELDS = [
  "schemaVersion",
  "status",
  "projectId",
  "documentId",
  "requestId",
  "attemptId",
  "candidateVersionId",
  "baseSha256",
  "outputSha256",
  "baseComparisonSha256",
  "outputComparisonSha256",
  "issueCodes",
  "health",
  "continuity",
  "assessedAt",
];
const HEALTH_FIELDS = new Set([
  "completeDocument",
  "bodyHasContent",
]);
const CONTINUITY_FIELDS = new Set([
  "status",
  "evidencePoints",
  "sameTitle",
  "text",
  "anchors",
  "classes",
  "assets",
  "baseVisibleTextLength",
  "outputVisibleTextLength",
  "baseBodyElementCount",
  "outputBodyElementCount",
  "baseParseErrorCount",
  "outputParseErrorCount",
]);
const OVERLAP_FIELDS = new Set(["score", "shared", "base", "output"]);
const BOUNDED_IMPACT_FIELDS = [
  "changedElementCount",
  "requestedTargetCount",
  "outsideTargetCount",
  "changedElementIdSample",
  "outsideTargetElementIdSample",
  "truncated",
];
const BOUNDED_IMPACT_MARKER_FIELDS = BOUNDED_IMPACT_FIELDS.filter(
  (field) => field !== "requestedTargetCount",
);
const SHA256_PATTERN = /^sha256:[a-f0-9]{64}$/;
const ID_PATTERNS = {
  projectId: /^project_[A-Za-z0-9_-]+$/,
  documentId: /^doc_[A-Za-z0-9_-]+$/,
  requestId: /^req_[A-Za-z0-9_-]+$/,
  attemptId: /^attempt_[0-9]{3}$/,
  candidateVersionId: /^ver_\d{4,}$/,
};

function decodeError(code, message, details) {
  return new LifecycleError(code, message, details, 409);
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw decodeError(
      "CANDIDATE_ASSESSMENT_INVALID",
      `${label} must be an object.`,
    );
  }
  return value;
}

function assertExactFields(value, allowed, label) {
  const item = record(value, label);
  const unknown = Object.keys(item).find((key) => !allowed.has(key));
  if (unknown) {
    throw decodeError(
      "CANDIDATE_ASSESSMENT_INVALID",
      `${label}.${unknown} is not supported.`,
    );
  }
  return item;
}

function assertRequiredFields(value, fields, label) {
  const missing = fields.find((field) => !Object.hasOwn(value, field));
  if (missing) {
    throw decodeError(
      "CANDIDATE_ASSESSMENT_INVALID",
      `${label}.${missing} is required.`,
    );
  }
}

function assertNonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw decodeError(
      "CANDIDATE_ASSESSMENT_INVALID",
      `${label} must be a non-negative safe integer.`,
    );
  }
}

function assertOverlap(value, label) {
  const overlap = assertExactFields(value, OVERLAP_FIELDS, label);
  assertRequiredFields(overlap, [...OVERLAP_FIELDS], label);
  if (
    overlap.score !== null
    && (typeof overlap.score !== "number" || !Number.isFinite(overlap.score))
  ) {
    throw decodeError(
      "CANDIDATE_ASSESSMENT_INVALID",
      `${label}.score must be a finite number or null.`,
    );
  }
  for (const field of ["shared", "base", "output"]) {
    assertNonNegativeInteger(overlap[field], `${label}.${field}`);
  }
}

function assertBoundedStableIdSample(value, label) {
  if (
    !Array.isArray(value)
    || value.length > IMPACT_SAMPLE_LIMIT
    || value.some((id) => !isValidStemmioElementId(id))
    || new Set(value).size !== value.length
  ) {
    throw decodeError(
      "CANDIDATE_ASSESSMENT_INVALID",
      label + " must contain at most "
        + IMPACT_SAMPLE_LIMIT
        + " unique valid Stable IDs.",
    );
  }
}

function assertCandidateAssessmentShape(assessment, label) {
  const value = assertExactFields(assessment, ROOT_FIELDS, label);
  assertRequiredFields(value, REQUIRED_ROOT_FIELDS, label);
  assertSchemaVersion(value, AUXILIARY_SCHEMA_VERSION, label);
  if (!["ready", "attention", "blocked"].includes(value.status)) {
    throw decodeError(
      "CANDIDATE_ASSESSMENT_INVALID",
      `${label} has an unsupported status.`,
    );
  }
  for (const [field, pattern] of Object.entries(ID_PATTERNS)) {
    if (typeof value[field] !== "string" || !pattern.test(value[field])) {
      throw decodeError(
        "CANDIDATE_ASSESSMENT_INVALID",
        `${label}.${field} has an invalid format.`,
      );
    }
  }
  for (const field of [
    "baseSha256",
    "outputSha256",
    "baseComparisonSha256",
    "outputComparisonSha256",
  ]) {
    if (typeof value[field] !== "string" || !SHA256_PATTERN.test(value[field])) {
      throw decodeError(
        "CANDIDATE_ASSESSMENT_INVALID",
        `${label}.${field} must use sha256:<64 lowercase hex>.`,
      );
    }
  }
  if (
    !Array.isArray(value.issueCodes)
    || value.issueCodes.some((code) => typeof code !== "string" || !code)
    || new Set(value.issueCodes).size !== value.issueCodes.length
    || typeof value.assessedAt !== "string"
    || Number.isNaN(Date.parse(value.assessedAt))
  ) {
    throw decodeError(
      "CANDIDATE_ASSESSMENT_INVALID",
      `${label} has invalid status evidence.`,
    );
  }
  const health = assertExactFields(value.health, HEALTH_FIELDS, `${label}.health`);
  assertRequiredFields(health, ["completeDocument", "bodyHasContent"], `${label}.health`);
  if (
    typeof health.completeDocument !== "boolean"
    || typeof health.bodyHasContent !== "boolean"
  ) {
    throw decodeError(
      "CANDIDATE_ASSESSMENT_INVALID",
      `${label}.health is structurally invalid.`,
    );
  }
  const continuity = assertExactFields(
    value.continuity,
    CONTINUITY_FIELDS,
    `${label}.continuity`,
  );
  assertRequiredFields(continuity, [...CONTINUITY_FIELDS], `${label}.continuity`);
  if (
    !["related", "uncertain"].includes(continuity.status)
    || typeof continuity.sameTitle !== "boolean"
  ) {
    throw decodeError(
      "CANDIDATE_ASSESSMENT_INVALID",
      `${label}.continuity is structurally invalid.`,
    );
  }
  for (const field of [
    "evidencePoints",
    "baseVisibleTextLength",
    "outputVisibleTextLength",
    "baseBodyElementCount",
    "outputBodyElementCount",
    "baseParseErrorCount",
    "outputParseErrorCount",
  ]) {
    assertNonNegativeInteger(continuity[field], `${label}.continuity.${field}`);
  }
  for (const field of ["text", "anchors", "classes", "assets"]) {
    assertOverlap(continuity[field], `${label}.continuity.${field}`);
  }

  const hasBoundedImpact = BOUNDED_IMPACT_MARKER_FIELDS.some(
    (field) => Object.hasOwn(value, field),
  );
  if (
    Object.hasOwn(value, "requestedTargetCount")
    && !hasBoundedImpact
  ) {
    throw decodeError(
      "CANDIDATE_ASSESSMENT_INVALID",
      label + " has incomplete impact evidence.",
    );
  }
  if (hasBoundedImpact) {
    assertRequiredFields(value, BOUNDED_IMPACT_FIELDS, label);
    assertNonNegativeInteger(value.changedElementCount, `${label}.changedElementCount`);
    assertNonNegativeInteger(value.requestedTargetCount, `${label}.requestedTargetCount`);
    assertNonNegativeInteger(value.outsideTargetCount, `${label}.outsideTargetCount`);
    if (value.outsideTargetCount > value.changedElementCount) {
      throw decodeError(
        "CANDIDATE_ASSESSMENT_INVALID",
        `${label}.outsideTargetCount cannot exceed changedElementCount.`,
      );
    }
    assertBoundedStableIdSample(
      value.changedElementIdSample,
      `${label}.changedElementIdSample`,
    );
    assertBoundedStableIdSample(
      value.outsideTargetElementIdSample,
      `${label}.outsideTargetElementIdSample`,
    );
    if (
      typeof value.truncated !== "boolean"
      || value.truncated !== (
        value.changedElementCount > value.changedElementIdSample.length
        || value.outsideTargetCount > value.outsideTargetElementIdSample.length
      )
    ) {
      throw decodeError(
        "CANDIDATE_ASSESSMENT_INVALID",
        `${label}.truncated does not match its bounded samples.`,
      );
    }
  }
  return value;
}

function assertExpectedIdentity(value, expected, label) {
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (
      expectedValue !== undefined
      && expectedValue !== null
      && value[field] !== expectedValue
    ) {
      throw decodeError(
        "CANDIDATE_ASSESSMENT_IDENTITY_MISMATCH",
        `${label} ${field} does not match its lifecycle record.`,
        { field, expected: expectedValue, actual: value[field] },
      );
    }
  }
}

/**
 * Policy-only view of a current candidate assessment. Persisted input must
 * already be the current shape; retired executable-surface fields stay invalid.
 */
export function normalizeCandidateAssessmentPolicy(assessment) {
  const value = assessment && typeof assessment === "object"
    && !Array.isArray(assessment)
    ? assessment
    : {};
  const health = value.health && typeof value.health === "object"
    && !Array.isArray(value.health)
    ? value.health
    : {};
  return {
    ...value,
    health: {
      completeDocument: health.completeDocument === true,
      bodyHasContent: health.bodyHasContent === true,
    },
  };
}

export function decodeCandidateAssessmentRecord(
  assessment,
  { expected = {}, label = "candidate-assessment.json" } = {},
) {
  const value = assertCandidateAssessmentShape(assessment, label);
  assertExpectedIdentity(value, expected, label);
  const canonical = normalizeCandidateAssessmentPolicy(value);
  assertCandidateAssessmentShape(canonical, label);
  return canonical;
}

export function decodeHistoricalCandidateAssessment(
  assessment,
  {
    expected = {},
    baseBuffer,
    outputBuffer,
    label = "candidate-assessment.json",
  } = {},
) {
  const normalized = decodeCandidateAssessmentRecord(assessment, {
    expected,
    label,
  });
  if (!Buffer.isBuffer(baseBuffer) || !Buffer.isBuffer(outputBuffer)) {
    throw decodeError(
      "CANDIDATE_ASSESSMENT_LEGACY_EVIDENCE_INVALID",
      `${label} evidence must be ordinary file bytes.`,
    );
  }
  const baseHtml = baseBuffer.toString("utf8");
  const outputHtml = outputBuffer.toString("utf8");
  if (
    sha256(baseBuffer) !== normalized.baseSha256
    || sha256(outputBuffer) !== normalized.outputSha256
    || comparisonSha256(baseHtml) !== normalized.baseComparisonSha256
    || comparisonSha256(outputHtml) !== normalized.outputComparisonSha256
  ) {
    throw decodeError(
      "CANDIDATE_ASSESSMENT_LEGACY_EVIDENCE_MISMATCH",
      `${label} no longer matches its sealed HTML evidence.`,
    );
  }
  const hasBoundedImpact = BOUNDED_IMPACT_FIELDS.every(
    (field) => Object.hasOwn(normalized, field),
  );
  const current = {
    schemaVersion: normalized.schemaVersion,
    projectId: normalized.projectId,
    documentId: normalized.documentId,
    requestId: normalized.requestId,
    attemptId: normalized.attemptId,
    candidateVersionId: normalized.candidateVersionId,
    baseSha256: normalized.baseSha256,
    outputSha256: normalized.outputSha256,
    baseComparisonSha256: normalized.baseComparisonSha256,
    outputComparisonSha256: normalized.outputComparisonSha256,
    ...assessHtmlCandidate({
      baseHtml,
      outputHtml,
      includeImpact: false,
    }),
    assessedAt: normalized.assessedAt,
  };
  if (hasBoundedImpact) {
    Object.assign(current, {
      changedElementCount: normalized.changedElementCount,
      requestedTargetCount: normalized.requestedTargetCount,
      outsideTargetCount: normalized.outsideTargetCount,
      changedElementIdSample: normalized.changedElementIdSample,
      outsideTargetElementIdSample: normalized.outsideTargetElementIdSample,
      truncated: normalized.truncated,
    });
  }
  if (!isDeepStrictEqual(normalized, current)) {
    throw decodeError(
      "CANDIDATE_ASSESSMENT_INVALID",
      `${label} does not match its sealed HTML evidence.`,
    );
  }
  return normalized;
}

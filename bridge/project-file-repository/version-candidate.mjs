// Version snapshot paths and Candidate identity/assessment evidence.
import {
  IMPACT_SAMPLE_LIMIT,
  assessHtmlCandidate,
} from "../candidate-assessment.mjs";
import {
  isValidStemmioElementId,
} from "../../shared/stemmio-element-identity.mjs";

import {
  ProjectFileRepositoryError,
} from "./errors.mjs";
import {
  assertCandidateSourceIdentityReport,
} from "./candidate-identity.mjs";
import {
  ensureRelativePath,
  isObject,
  nowIso,
  pathInside,
  resolveRelative,
} from "./path-safety.mjs";

export function mapCandidateValidationError(cause) {
  const code = String(cause?.code || "");
  const message = String(cause?.message || "");
  if (code === "INCOMPLETE_HTML") {
    return {
      errorCode: "INCOMPLETE_HTML",
      message: message || "The Candidate HTML is incomplete.",
      errorDetail: "输出缺少完整 HTML 文档结构",
      recoveryHint: "请检查 AI Agent 的输出是否被截断，然后重新提交。",
    };
  }
  if (
    code === "CANDIDATE_HASH_MISMATCH"
    || code === "FROZEN_INPUT_HASH_MISMATCH"
    || code === "REQUEST_OUTPUT_CHANGED"
    || code === "HASH_MISMATCH"
  ) {
    return {
      errorCode: "HASH_MISMATCH",
      message: message || "The Candidate HTML hash did not match the sealed record.",
      errorDetail: "输出内容与声明的 Hash 不一致",
      recoveryHint: "请重新提交完整输出，不要改动校验字段。",
    };
  }
  if (code === "CANDIDATE_UNUSABLE" || code === "PROTOCOL_FIELD_MISSING") {
    return {
      errorCode: "PROTOCOL_FIELD_MISSING",
      message: message || "The Candidate HTML is unusable.",
      errorDetail: "输出缺少必要的协议字段或无法作为完整页面使用",
      recoveryHint: "请检查 AI Agent 的输出是否完整，然后重新提交。",
    };
  }
  if (code.startsWith("CANDIDATE_SOURCE_IDENTITY_")) {
    return {
      errorCode: "CANDIDATE_IDENTITY_INVALID",
      message: message || "The Candidate source identities are invalid.",
      errorDetail: "输出未保留现有源码元素身份，或包含重复、伪造的 Stable ID",
      recoveryHint: "请让 AI 保留所有仍存在元素的 data-stemmio-id，并删除对新增元素自行填写的 ID 后重新提交。",
    };
  }
  return null;
}

export function versionSnapshotPath(paths, version) {
  const relative = ensureRelativePath(version.snapshotRelativePath, "snapshotRelativePath");
  const resolved = resolveRelative(paths.controlRoot, relative, "snapshotRelativePath");
  if (!pathInside(paths.versionsRoot, resolved)) {
    throw new ProjectFileRepositoryError(
      "PATH_ESCAPES_PROJECT",
      "A Version snapshot must stay inside versions/.",
    );
  }
  return resolved;
}

export function assertCandidateId(value) {
  const id = String(value || "");
  if (!/^candidate_[A-Za-z0-9_-]{8,160}$/u.test(id)) {
    throw new ProjectFileRepositoryError("INVALID_CANDIDATE_ID", "candidateId is invalid.");
  }
  return id;
}

export function assessedCandidate(
  baseHtml,
  outputHtml,
  clock,
  {
    requestedTargetElementIds = [],
    requestedTargetCount = requestedTargetElementIds.length,
    requestedTargetIsPage = false,
  } = {},
) {
  const assessment = {
    ...assessHtmlCandidate({
      baseHtml,
      outputHtml,
      requestedTargetElementIds,
      requestedTargetCount,
      requestedTargetIsPage,
    }),
    assessedAt: nowIso(clock),
  };
  if (assessment.status === "blocked") {
    throw new ProjectFileRepositoryError(
      "CANDIDATE_UNUSABLE",
      "The Candidate HTML could not be safely adopted.",
      { issueCodes: assessment.issueCodes },
    );
  }
  return assessment;
}

export function assertCandidateAssessment(assessment) {
  if (
    !isObject(assessment)
    || assessment.schemaVersion !== "1.0.0"
    || !["ready", "attention"].includes(assessment.status)
    || !Array.isArray(assessment.issueCodes)
    || assessment.issueCodes.some((value) => typeof value !== "string" || !value)
    || !isObject(assessment.health)
    || typeof assessment.health.completeDocument !== "boolean"
    || typeof assessment.health.bodyHasContent !== "boolean"
    || !isObject(assessment.continuity)
    || !["related", "uncertain"].includes(assessment.continuity.status)
    || !assessment.assessedAt
    || Number.isNaN(Date.parse(assessment.assessedAt))
  ) {
    throw new ProjectFileRepositoryError(
      "CANDIDATE_VALIDATION_INVALID",
      "Candidate validation evidence is invalid.",
    );
  }
  const boundedImpactFields = [
    "changedElementCount",
    "requestedTargetCount",
    "outsideTargetCount",
    "changedElementIdSample",
    "outsideTargetElementIdSample",
    "truncated",
  ];
  const hasBoundedImpact = boundedImpactFields.some((field) => Object.hasOwn(assessment, field));
  if ([
    "changedStableElementIds",
    "requestedTargetElementIds",
    "outsideRequestedTargetElementIds",
  ].some((field) => Object.hasOwn(assessment, field))) {
    throw new ProjectFileRepositoryError(
      "CANDIDATE_VALIDATION_INVALID",
      "Legacy Candidate impact evidence is unsupported.",
    );
  }
  if (hasBoundedImpact) {
    const validSample = (value) => (
      Array.isArray(value)
      && value.length <= IMPACT_SAMPLE_LIMIT
      && value.every((id) => isValidStemmioElementId(id))
      && new Set(value).size === value.length
    );
    if (
      !boundedImpactFields.every((field) => Object.hasOwn(assessment, field))
      || !Number.isSafeInteger(assessment.changedElementCount)
      || assessment.changedElementCount < 0
      || !Number.isSafeInteger(assessment.requestedTargetCount)
      || assessment.requestedTargetCount < 0
      || !Number.isSafeInteger(assessment.outsideTargetCount)
      || assessment.outsideTargetCount < 0
      || assessment.outsideTargetCount > assessment.changedElementCount
      || !validSample(assessment.changedElementIdSample)
      || !validSample(assessment.outsideTargetElementIdSample)
      || typeof assessment.truncated !== "boolean"
      || assessment.truncated !== (
        assessment.changedElementCount > assessment.changedElementIdSample.length
        || assessment.outsideTargetCount > assessment.outsideTargetElementIdSample.length
      )
    ) {
      throw new ProjectFileRepositoryError(
        "CANDIDATE_VALIDATION_INVALID",
        "Bounded Candidate impact evidence is invalid.",
      );
    }
  }
  return assessment;
}

export function assertCandidateIdentityReport(report) {
  return assertCandidateSourceIdentityReport(report);
}

export const TASK_SPEC_SCHEMA_VERSION = "1.0.0";

export const TASK_SCOPE_TARGETS_ONLY = "targets-only";
export const TASK_SCOPE_TARGETS_PLUS_DEPENDENCIES =
  "targets-plus-required-dependencies";
export const TASK_SCOPE_WHOLE_PAGE = "whole-page";

const TASK_SCOPE_POLICIES = new Set([
  TASK_SCOPE_TARGETS_ONLY,
  TASK_SCOPE_TARGETS_PLUS_DEPENDENCIES,
  TASK_SCOPE_WHOLE_PAGE,
]);

const TASK_KEYS = new Set([
  "taskSchemaVersion",
  "objective",
  "scopePolicy",
  "instructions",
  "globalAcceptanceCriteria",
  "nonGoals",
  "targets",
  "attachments",
]);

const INSTRUCTION_KEYS = new Set([
  "instructionId",
  "priority",
  "text",
  "targetRefs",
  "acceptanceCriteria",
  "attachmentRefs",
]);

const INSTRUCTION_ID = /^instruction_[A-Za-z0-9_-]+$/u;
const TARGET_ID = /^target_[A-Za-z0-9_-]+$/u;
const ATTACHMENT_ID = /^attachment_[A-Za-z0-9_-]+$/u;

const STRICT_SOURCE_SCOPE = /(?:不得|不允许|严禁|不要|不)(?:修改|改动|重写)(?:任何)?(?:评论)?目标(?:之外|以外)的(?:源码|代码)|(?:only\s+(?:edit|modify)\s+(?:source\s+)?inside|do\s+not\s+(?:edit|modify)\s+(?:source\s+)?outside)\s+(?:the\s+)?targets?/iu;
const ACCEPTANCE_SIGNAL = /(?:验收|完成标准|必须|务必|确保|应当|需要保持|不得|不能|不应|不要改变|不影响|不新增|不溢出)/u;
const NON_GOAL_SIGNAL = /(?:本轮)?(?:不需要|无需|无须|不用)(?:处理|修改|调整|重做|涉及)|(?:不在|不属于)本轮|(?:不做|不要进行)(?:无关)?(?:重构|重做|改版|迁移|设计)/u;

function taskSpecError(message) {
  const error = new TypeError(message);
  error.code = "TASK_SPEC_INVALID";
  return error;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw taskSpecError(`${label}.${key} is not supported.`);
  }
}

function boundedText(value, label, { min = 0, max = 20_000 } = {}) {
  const text = typeof value === "string" ? value.trim() : "";
  if (text.length < min || text.length > max) {
    throw taskSpecError(`${label} is outside the supported length.`);
  }
  return text;
}

function uniqueStrings(values, label, pattern = null, maxItems = 100) {
  if (!Array.isArray(values) || values.length > maxItems) {
    throw taskSpecError(`${label} must be a bounded array.`);
  }
  const normalized = values.map((value, index) => {
    const text = boundedText(value, `${label}[${index}]`, { min: 1, max: 20_000 });
    if (pattern && !pattern.test(text)) {
      throw taskSpecError(`${label}[${index}] is invalid.`);
    }
    return text;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw taskSpecError(`${label} contains duplicates.`);
  }
  return normalized;
}

function instructionText(comment) {
  const text = typeof comment?.text === "string" ? comment.text.trim() : "";
  if (text) return text;
  return "请结合本条评论所附附件完成修改。";
}

function clauses(text) {
  return String(text || "")
    .split(/(?:\r?\n|[。！？!?；;])/u)
    .map((value) => value.trim())
    .filter(Boolean);
}

function exactMatchingClauses(text, pattern) {
  return [...new Set(clauses(text).filter((value) => pattern.test(value)))];
}

function sourceTargetForComment(comment) {
  return comment?.sourceAnchor || comment?.target || comment || null;
}

function commentHasRuntimeVisualHint(comment) {
  return comment?.visualHint?.runtimeGenerated === true
    || comment?.target?.visualHint?.runtimeGenerated === true;
}

function isExplicitGlobalComment(comment) {
  const sourceTarget = sourceTargetForComment(comment);
  return String(sourceTarget?.selector || "").trim().toLowerCase() === "body"
    && sourceTarget?.level === "module"
    && !commentHasRuntimeVisualHint(comment);
}

function scopePolicyFor(comments, targets) {
  if (
    comments.some(isExplicitGlobalComment)
    || (
      comments.length === 0
      && targets.some((target) => (
        String(target?.selector || "").trim().toLowerCase() === "body"
      ))
    )
  ) return TASK_SCOPE_WHOLE_PAGE;
  if (comments.some((comment) => STRICT_SOURCE_SCOPE.test(String(comment?.text || "")))) {
    return TASK_SCOPE_TARGETS_ONLY;
  }
  return TASK_SCOPE_TARGETS_PLUS_DEPENDENCIES;
}

function instructionFromComment(comment, index) {
  const commentId = String(comment?.commentId || "");
  const sourceTarget = comment?.sourceAnchor || comment?.target;
  const targetId = String(sourceTarget?.targetId || "");
  if (!TARGET_ID.test(targetId)) {
    throw taskSpecError(`comments[${index}] has no valid target.`);
  }
  const derivedInstructionId = `instruction_${commentId.replace(/^comment_/u, "")}`;
  if (!INSTRUCTION_ID.test(derivedInstructionId)) {
    throw taskSpecError(`comments[${index}] has no valid instruction identity.`);
  }
  const text = instructionText(comment);
  const attachmentRefs = (Array.isArray(comment?.attachments) ? comment.attachments : [])
    .map((attachment) => String(attachment?.attachmentId || ""));
  return {
    instructionId: derivedInstructionId,
    priority: "required",
    text,
    targetRefs: [targetId],
    acceptanceCriteria: exactMatchingClauses(text, ACCEPTANCE_SIGNAL),
    ...(attachmentRefs.length > 0 ? { attachmentRefs } : {}),
  };
}

export function compileTaskSpec({
  comments = [],
  targets = [],
  attachments = [],
} = {}) {
  if (!Array.isArray(comments) || !Array.isArray(targets) || !Array.isArray(attachments)) {
    throw taskSpecError("Task Spec inputs must be arrays.");
  }
  const compiledInstructions = comments.map(instructionFromComment);
  if (compiledInstructions.length === 0) {
    throw taskSpecError("Task Spec requires at least one instruction.");
  }
  const instructionTexts = compiledInstructions.map((instruction) => instruction.text);
  const objective = instructionTexts.join("；").slice(0, 5_000);
  const nonGoals = [...new Set(
    instructionTexts.flatMap((text) => exactMatchingClauses(text, NON_GOAL_SIGNAL)),
  )];
  const scopePolicy = scopePolicyFor(comments, targets);
  return assertTaskSpec({
    taskSchemaVersion: TASK_SPEC_SCHEMA_VERSION,
    objective,
    scopePolicy,
    instructions: compiledInstructions,
    globalAcceptanceCriteria: [],
    nonGoals,
    targets: structuredClone(targets),
    attachments: structuredClone(attachments),
  }, { requireAttachmentResolution: attachments.length > 0 });
}

export function assertTaskSpec(value, { requireAttachmentResolution = true } = {}) {
  if (!isRecord(value)) throw taskSpecError("Task Spec must be an object.");
  assertExactKeys(value, TASK_KEYS, "taskSpec");
  if (value.taskSchemaVersion !== TASK_SPEC_SCHEMA_VERSION) {
    throw taskSpecError("Task Spec schema version is unsupported.");
  }
  const objective = boundedText(value.objective, "taskSpec.objective", { min: 1, max: 5_000 });
  if (!TASK_SCOPE_POLICIES.has(value.scopePolicy)) {
    throw taskSpecError("Task Spec scope policy is invalid.");
  }
  if (!Array.isArray(value.targets) || value.targets.length === 0) {
    throw taskSpecError("Task Spec requires at least one target.");
  }
  const targetIds = new Set();
  const targets = value.targets.map((target, index) => {
    if (!isRecord(target)) throw taskSpecError(`taskSpec.targets[${index}] is invalid.`);
    const targetId = String(target.targetId || "");
    if (!TARGET_ID.test(targetId) || targetIds.has(targetId)) {
      throw taskSpecError(`taskSpec.targets[${index}] identity is invalid.`);
    }
    targetIds.add(targetId);
    return structuredClone(target);
  });
  if (!Array.isArray(value.attachments)) {
    throw taskSpecError("taskSpec.attachments must be an array.");
  }
  const attachmentIds = new Set();
  const attachments = value.attachments.map((attachment, index) => {
    if (!isRecord(attachment)) {
      throw taskSpecError(`taskSpec.attachments[${index}] is invalid.`);
    }
    const attachmentId = String(attachment.attachmentId || "");
    if (!ATTACHMENT_ID.test(attachmentId) || attachmentIds.has(attachmentId)) {
      throw taskSpecError(`taskSpec.attachments[${index}] identity is invalid.`);
    }
    attachmentIds.add(attachmentId);
    return structuredClone(attachment);
  });
  if (!Array.isArray(value.instructions) || value.instructions.length === 0) {
    throw taskSpecError("Task Spec requires at least one instruction.");
  }
  const instructionIds = new Set();
  const instructions = value.instructions.map((instruction, index) => {
    if (!isRecord(instruction)) {
      throw taskSpecError(`taskSpec.instructions[${index}] is invalid.`);
    }
    assertExactKeys(instruction, INSTRUCTION_KEYS, `taskSpec.instructions[${index}]`);
    const instructionId = String(instruction.instructionId || "");
    if (!INSTRUCTION_ID.test(instructionId) || instructionIds.has(instructionId)) {
      throw taskSpecError(`taskSpec.instructions[${index}] identity is invalid.`);
    }
    instructionIds.add(instructionId);
    if (instruction.priority !== "required") {
      throw taskSpecError(`taskSpec.instructions[${index}] priority is invalid.`);
    }
    const targetRefs = uniqueStrings(
      instruction.targetRefs,
      `taskSpec.instructions[${index}].targetRefs`,
      TARGET_ID,
    );
    if (targetRefs.length === 0 || targetRefs.some((targetRef) => !targetIds.has(targetRef))) {
      throw taskSpecError(`taskSpec.instructions[${index}] references an unknown target.`);
    }
    const attachmentRefs = instruction.attachmentRefs === undefined
      ? []
      : uniqueStrings(
          instruction.attachmentRefs,
          `taskSpec.instructions[${index}].attachmentRefs`,
          ATTACHMENT_ID,
        );
    if (
      requireAttachmentResolution
      && attachmentRefs.some((attachmentRef) => !attachmentIds.has(attachmentRef))
    ) {
      throw taskSpecError(`taskSpec.instructions[${index}] references an unknown attachment.`);
    }
    return {
      instructionId,
      priority: "required",
      text: boundedText(instruction.text, `taskSpec.instructions[${index}].text`, {
        min: 1,
        max: 20_000,
      }),
      targetRefs,
      acceptanceCriteria: uniqueStrings(
        instruction.acceptanceCriteria,
        `taskSpec.instructions[${index}].acceptanceCriteria`,
        null,
        50,
      ),
      ...(attachmentRefs.length > 0 ? { attachmentRefs } : {}),
    };
  });
  return Object.freeze({
    taskSchemaVersion: TASK_SPEC_SCHEMA_VERSION,
    objective,
    scopePolicy: value.scopePolicy,
    instructions: Object.freeze(instructions),
    globalAcceptanceCriteria: Object.freeze(uniqueStrings(
      value.globalAcceptanceCriteria,
      "taskSpec.globalAcceptanceCriteria",
      null,
      50,
    )),
    nonGoals: Object.freeze(uniqueStrings(value.nonGoals, "taskSpec.nonGoals", null, 50)),
    targets: Object.freeze(targets),
    attachments: Object.freeze(attachments),
  });
}

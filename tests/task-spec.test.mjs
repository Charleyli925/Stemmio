import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import {
  TASK_SCOPE_TARGETS_ONLY,
  TASK_SCOPE_TARGETS_PLUS_DEPENDENCIES,
  TASK_SCOPE_WHOLE_PAGE,
  TASK_SPEC_SCHEMA_VERSION,
  assertTaskSpec,
  assertTaskSpecCommentAttachments,
  compileTaskSpec,
} from "../shared/task-spec.mjs";

const ELEMENT_ID = "sm1_11111111111141118111111111111111";
const SOURCE_SHA = `sha256:${"1".repeat(64)}`;

function target(overrides = {}) {
  return {
    targetId: "target_title",
    elementId: ELEMENT_ID,
    expectedSourceSha256: SOURCE_SHA,
    label: "首屏标题",
    level: "module",
    selector: "h1",
    fingerprint: {
      tagName: "h1",
      stableAttributes: {},
      ancestorFingerprint: [],
    },
    resolution: "exact",
    ...overrides,
  };
}

function comment(text, targetValue = target(), attachments = []) {
  return {
    commentId: "comment_title",
    text,
    target: targetValue,
    attachments,
  };
}

function pairedComments() {
  const firstTarget = target({ targetId: "target_first", label: "第一处" });
  const secondTarget = target({ targetId: "target_second", label: "第二处" });
  return {
    comments: [
      {
        commentId: "comment_first",
        text: "处理第一处。",
        target: firstTarget,
        attachments: [{ attachmentId: "attachment_first" }],
      },
      {
        commentId: "comment_second",
        text: "处理第二处。",
        target: secondTarget,
        attachments: [{ attachmentId: "attachment_second" }],
      },
    ],
    targets: [firstTarget, secondTarget],
  };
}

test("Task Spec compiles exact comments without adding requirements", () => {
  const text = "强化主按钮层级。确保移动端不溢出；本轮不需要修改导航栏。";
  const spec = compileTaskSpec({
    comments: [comment(text)],
    targets: [target()],
  });

  assert.equal(spec.taskSchemaVersion, TASK_SPEC_SCHEMA_VERSION);
  assert.equal(spec.objective, text);
  assert.equal(spec.scopePolicy, TASK_SCOPE_TARGETS_PLUS_DEPENDENCIES);
  assert.deepEqual(spec.instructions, [{
    instructionId: "instruction_title",
    priority: "required",
    text,
    targetRefs: ["target_title"],
    acceptanceCriteria: ["确保移动端不溢出"],
  }]);
  assert.deepEqual(spec.globalAcceptanceCriteria, []);
  assert.deepEqual(spec.nonGoals, ["本轮不需要修改导航栏"]);
  assert.deepEqual(spec.attachments, []);
});

test("Task Spec derives whole-page and strict-source scopes conservatively", () => {
  const pageTarget = target({
    targetId: "target_page",
    elementId: undefined,
    expectedSourceSha256: undefined,
    label: "整个页面",
    selector: "body",
    fingerprint: undefined,
  });
  const wholePage = compileTaskSpec({
    comments: [{
      commentId: "comment_page",
      text: "统一整页的视觉层级。",
      target: pageTarget,
      attachments: [],
    }],
    targets: [pageTarget],
  });
  assert.equal(wholePage.scopePolicy, TASK_SCOPE_WHOLE_PAGE);

  const targetsOnly = compileTaskSpec({
    comments: [comment("不得修改评论目标之外的源码。")],
    targets: [target()],
  });
  assert.equal(targetsOnly.scopePolicy, TASK_SCOPE_TARGETS_ONLY);
});

test("Runtime visual comments keep a body fallback out of whole-page scope", () => {
  const pageSourceTarget = target({
    targetId: "target_runtime_page_host",
    elementId: undefined,
    expectedSourceSha256: undefined,
    label: "整个页面",
    selector: "body",
    fingerprint: undefined,
  });
  const runtimeComment = {
    commentId: "comment_runtime_table",
    text: "核对页面级财务数据表。",
    target: {
      ...pageSourceTarget,
      label: "财务数据表",
      visualHint: {
        runtimeGenerated: true,
        kind: "table",
        label: "财务数据表",
        renderedText: "项目 2025Q1 2025Q2",
        relativePath: "table:nth-of-type(1)",
        relativeBox: { x: 0.1, y: 0.2, width: 0.7, height: 0.2 },
      },
    },
    sourceAnchor: pageSourceTarget,
  };
  const spec = compileTaskSpec({
    comments: [runtimeComment],
    targets: [pageSourceTarget],
  });
  assert.equal(spec.scopePolicy, TASK_SCOPE_TARGETS_PLUS_DEPENDENCIES);
});

test("Task Spec keeps attachment references unresolved until Request bytes freeze", () => {
  const draftAttachment = { attachmentId: "attachment_reference" };
  const pending = compileTaskSpec({
    comments: [comment("参考附件调整标题。", target(), [draftAttachment])],
    targets: [target()],
  });
  assert.deepEqual(pending.instructions[0].attachmentRefs, ["attachment_reference"]);
  assert.throws(
    () => assertTaskSpec(pending),
    (error) => error?.code === "TASK_SPEC_INVALID",
  );
  assert.doesNotThrow(
    () => assertTaskSpec(pending, { requireAttachmentResolution: false }),
  );
});

test("Task Spec binds each instruction refs set to its own comment", () => {
  const { comments, targets } = pairedComments();
  const pending = compileTaskSpec({ comments, targets });
  assert.doesNotThrow(() => assertTaskSpecCommentAttachments(pending, comments));

  const swapped = structuredClone(pending);
  [
    swapped.instructions[0].attachmentRefs,
    swapped.instructions[1].attachmentRefs,
  ] = [
    swapped.instructions[1].attachmentRefs,
    swapped.instructions[0].attachmentRefs,
  ];
  assert.throws(
    () => assertTaskSpecCommentAttachments(swapped, comments),
    (error) => error?.code === "TASK_SPEC_INVALID",
  );
});

test("resolved Task Spec attachments retain their comment binding", () => {
  const { comments, targets } = pairedComments();
  const valid = compileTaskSpec({
    comments,
    targets,
    attachments: [
      {
        attachmentId: "attachment_first",
        commentId: "comment_first",
        fileName: "first.txt",
        kind: "file",
      },
      {
        attachmentId: "attachment_second",
        commentId: "comment_second",
        fileName: "second.txt",
        kind: "file",
      },
    ],
  });
  assert.deepEqual(
    valid.attachments.map((attachment) => attachment.commentId),
    ["comment_first", "comment_second"],
  );

  const swapped = structuredClone(valid);
  swapped.attachments[0].commentId = "comment_second";
  assert.throws(
    () => assertTaskSpec(swapped),
    (error) => error?.code === "TASK_SPEC_INVALID",
  );
});

test("Task Spec v1 JSON Schema accepts the generated strict contract", async () => {
  const [taskSchema, changeRequestSchema] = await Promise.all([
    readFile(new URL("../schemas/task-spec.v1.schema.json", import.meta.url), "utf8"),
    readFile(new URL("../schemas/change-request.v3.schema.json", import.meta.url), "utf8"),
  ]).then((values) => values.map(JSON.parse));
  const ajv = new Ajv2020({ strict: true, strictRequired: false, allErrors: true });
  ajv.addFormat(
    "date-time",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  );
  ajv.addSchema(changeRequestSchema);
  const validate = ajv.compile(taskSchema);
  const spec = compileTaskSpec({
    comments: [comment("把标题改成欢迎页。")],
    targets: [target()],
  });
  assert.equal(validate(spec), true, ajv.errorsText(validate.errors));
});

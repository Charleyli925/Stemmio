import assert from "node:assert/strict";
import test from "node:test";

import {
  GLOBAL_INTERRUPTION_KINDS,
  globalInterruptionPresentation,
} from "../app/lib/global-interruption.js";

test("unknown kinds cannot present a free-form interruption", () => {
  assert.equal(globalInterruptionPresentation(null), null);
  assert.equal(globalInterruptionPresentation({ kind: "made-up-toast" }), null);
  assert.ok(GLOBAL_INTERRUPTION_KINDS.includes("external-agent-may-still-run"));
});

test("allowlisted copy is owned by the catalog, not the caller", () => {
  const presented = globalInterruptionPresentation({
    kind: "handoff-recopy",
    succeeded: false,
  });
  assert.equal(presented?.title, "复制没有成功");
  assert.equal(presented?.actionId, null);
});

test("project-open recovery preserves only an opaque Prepared request for its existing action", () => {
  const retryPrepared = globalInterruptionPresentation({
    kind: "project-open-failed",
    detail: "response lost after commit",
    requestId: "prepared_open_retry",
  });
  assert.equal(retryPrepared?.actionId, "retry-project-open");
  assert.equal(retryPrepared?.title, "打开尚未完成");
  assert.equal(retryPrepared?.actionLabel, "继续打开");
  assert.equal(retryPrepared?.actionRequestId, "prepared_open_retry");

  const reselect = globalInterruptionPresentation({
    kind: "project-open-failed",
    detail: "file moved",
  });
  assert.equal(reselect?.actionId, "retry-project-open");
  assert.equal(reselect?.actionLabel, "选择 HTML");
  assert.equal(reselect?.actionRequestId, undefined);

  const registered = globalInterruptionPresentation({
    kind: "project-open-failed",
    registered: true,
    detail: "项目目录暂时无法完成安全核对。",
  });
  assert.equal(registered?.title, "当前稿未打开");
  assert.equal(registered?.message, "无法确认项目文件状态，原页面保持不变。");
  assert.equal(registered?.actionId, null);
});

test("recovery actions name the destination they actually open", () => {
  const attachment = globalInterruptionPresentation({ kind: "attachment-rejected", needsRemoval: false });
  assert.equal(attachment?.actionId, "open-attachment-picker");
  assert.equal(attachment?.actionLabel, "选择附件");
  const exportFailure = globalInterruptionPresentation({ kind: "export-failed" });
  assert.equal(exportFailure?.actionId, "retry-export");
  assert.equal(exportFailure?.actionLabel, "选择导出位置");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceNoticeDeadline,
  canvasNoticeIdentity,
  globalNoticeIdentity,
  noticePauseActive,
} from "../app/lib/notice-lifetime.js";

test("an equal notice fact keeps its original deadline", () => {
  const started = advanceNoticeDeadline(null, {
    identity: "canvas:c12", dismissMs: 5_000, paused: false, now: 1_000,
  });
  const repeated = advanceNoticeDeadline(started, {
    identity: "canvas:c12", dismissMs: 5_000, paused: false, now: 3_000,
  });
  assert.equal(started.deadlineAt, 6_000);
  assert.equal(repeated.deadlineAt, 6_000);
  assert.equal(repeated.remainingMs, 3_000);
});

test("pause and resume preserve only the remaining notice lifetime", () => {
  const started = advanceNoticeDeadline(null, {
    identity: "global:copy", dismissMs: 8_000, paused: false, now: 10_000,
  });
  const paused = advanceNoticeDeadline(started, {
    identity: "global:copy", dismissMs: 8_000, paused: true, now: 12_500,
  });
  const stillPaused = advanceNoticeDeadline(paused, {
    identity: "global:copy", dismissMs: 8_000, paused: true, now: 40_000,
  });
  const resumed = advanceNoticeDeadline(stillPaused, {
    identity: "global:copy", dismissMs: 8_000, paused: false, now: 50_000,
  });
  assert.equal(paused.remainingMs, 5_500);
  assert.equal(stillPaused.remainingMs, 5_500);
  assert.equal(resumed.deadlineAt, 55_500);
});

test("a different fact receives a new lifetime and persistent facts have none", () => {
  const first = advanceNoticeDeadline(null, {
    identity: "canvas:c02", dismissMs: 5_000, paused: false, now: 1_000,
  });
  const next = advanceNoticeDeadline(first, {
    identity: "canvas:c03", dismissMs: 5_000, paused: false, now: 4_000,
  });
  assert.equal(next.deadlineAt, 9_000);
  assert.equal(advanceNoticeDeadline(next, {
    identity: "canvas:c01", dismissMs: null, paused: false, now: 4_500,
  }), null);
});

test("a new operation receives a full lifetime even when its notice code is unchanged", () => {
  const first = advanceNoticeDeadline(null, {
    identity: "canvas:c03:operation-1", dismissMs: 5_000, paused: false, now: 1_000,
  });
  const next = advanceNoticeDeadline(first, {
    identity: "canvas:c03:operation-2", dismissMs: 5_000, paused: false, now: 5_500,
  });
  assert.equal(next.deadlineAt, 10_500);
  assert.equal(next.remainingMs, 5_000);
});

test("Canvas identity coalesces repeat reports only within the same gesture and frame", () => {
  const input = {
    code: "canvas_c03_structure_scope",
    projectId: "project-a",
    documentKey: "document-a",
    frameGeneration: 4,
    operationEpoch: 7,
    title: "暂不支持这个结构操作",
    message: "请添加评论说明需要的结构调整。",
  };
  const first = canvasNoticeIdentity(input);
  assert.equal(canvasNoticeIdentity({ ...input }), first);
  assert.notEqual(canvasNoticeIdentity({ ...input, operationEpoch: 8 }), first);
  assert.notEqual(canvasNoticeIdentity({ ...input, frameGeneration: 5 }), first);
  assert.notEqual(canvasNoticeIdentity({ ...input, documentKey: "document-b" }), first);
});

test("pause authority ends when a notice is replaced, cleared, or hidden", () => {
  const current = { visible: true, identity: "canvas:1", pausedIdentity: "canvas:1" };
  assert.equal(noticePauseActive(current), true);
  assert.equal(noticePauseActive({ ...current, identity: "canvas:2" }), false);
  assert.equal(noticePauseActive({ ...current, identity: null }), false);
  assert.equal(noticePauseActive({ ...current, visible: false }), false);
});

test("global notice identity follows the operation, not repeated copy", () => {
  const recopy = { kind: "handoff-recopy", succeeded: true };
  assert.equal(globalNoticeIdentity({ interruption: recopy, sequence: 1 }), "interruption:1");
  assert.equal(globalNoticeIdentity({ interruption: recopy, sequence: 2 }), "interruption:2");
  const repeatedReport = { ...recopy, noticeIdentity: "run:123:recopy" };
  assert.equal(globalNoticeIdentity({ interruption: repeatedReport, sequence: 3 }), "run:123:recopy");
  assert.equal(globalNoticeIdentity({ interruption: repeatedReport, sequence: 4 }), "run:123:recopy");
});

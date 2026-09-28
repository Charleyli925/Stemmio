import assert from "node:assert/strict";
import test from "node:test";

import { advanceNoticeDeadline } from "../app/lib/notice-lifetime.js";

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

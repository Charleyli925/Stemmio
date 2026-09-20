---
name: stemmio-test-reliability
description: Design, review or triage asynchronous, harness, process and resource tests in Stemmio, including flake investigation and failure classification. Use for async or timing test design, Harness work and repeated failures; not for weakening an assertion to make a suite green.
---

# Stemmio Test Reliability

Trigger: writing or reviewing an asynchronous, cancel, lifecycle, harness,
process or resource test; investigating a flaky suite; classifying a repeated or
first failure.

Read the owned suite's existing conventions, `docs/DEVELOPMENT.md` for the lane
you run, and `tests/TEST_STRATEGY.md` sections `改动类型与证据质量`,
`结果从外部核验`, `反向证明`, `测试可靠性` and `失败分类与复测`. Gate selection,
retry policy and evidence reuse stay with the existing scripts; this skill adds
no parallel policy.

1. Wait on a condition, not on time: use an event, handshake, barrier or
   observable state. A fixed sleep is not readiness.
2. Give every resource an owner: ports, temporary directories, database
   namespaces, build output and child processes. Fix a parallel conflict with
   isolation before serializing the whole repository around it.
3. Restore global state — environment variables, clock, working directory, mocks
   and global interceptors — and cover the failure path, not only the clean one.
4. Clean up to an actual stop. `abort`, `close` or `kill` is a request; the test
   only ends once the work it owns has stopped, and late callbacks are isolated
   from the next case.
5. Justify every timeout by naming the awaited state and the time budget. Never
   buy green with an unexplained retry, extra time, swallowed error or weakened
   assertion, and never skip a selected test.
6. Verify the result from outside the implementation: files, state, durable
   records, events or exit results. Do not let the implementation recompute the
   expectation, and do not refresh a snapshot without reviewing the behavioral
   difference.
7. Prove a new guard, constraint or race regression can catch its target error:
   temporarily remove the protection, use the pre-fix version, or inject clearly
   invalid input, observe the expected failure through the real test entry, then
   restore it. Keep that experiment in an isolated environment or synthetic data.
8. On a failure, keep the first one with source identity, command, expected
   versus actual, logs and running conditions, then classify product, test,
   environment or unclassified. A local green rerun is not an environment
   verdict, and the same SHA cannot be washed green by rerunning.
9. Reuse only evidence that still applies to the current source, baseline,
   configuration, dependency, environment, command and artifacts; after a repair,
   rerun the invalidated evidence and the checks that depend on it.

Output: the counts in their own categories — planned, discovered, executed,
passed, failed, skipped, not executed — where an unknown count stays unknown
instead of zero; the first failure; the classification with its uncertainty; and
the evidence locations a reviewer can re-read.

Prohibitions: no editing product code, assertions, snapshots, gates, lockfiles or
dependencies; no replacement matrix; no rerun-for-green; no treating a tool's or
agent's own success report as the verified result; no personal app data, no
installed-app shortcuts, and no claim of completion while owned processes are
still running or a required suite is unexecuted.

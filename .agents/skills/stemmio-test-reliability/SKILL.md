---
name: stemmio-test-reliability
description: Design, implement, review or execute reliable asynchronous, harness, process and resource tests in Stemmio while preserving each role's write authority. Use for timing tests, harness work, flake investigation and failure classification.
---

# Stemmio Test Reliability

Use this skill for asynchronous, cancellation, lifecycle, harness, process or
resource tests, and for first-failure or flake investigation. Read the owned
suite's conventions. Read the applicable lane in
[Development](../../../docs/DEVELOPMENT.md) only when executing that lane, and
use the relevant parts of [Test strategy](../../../tests/TEST_STRATEGY.md#改动类型与证据质量)
for evidence and failure handling.

This skill supplies a method and does not change the task's role or authority:

| Role or task | Authority |
| --- | --- |
| Test implementer | Within the authorized implementation scope, may change tests and necessary product code, run isolated reverse experiments, restore the source and verify the result. |
| Tester | Runs specified existing checks against frozen source and preserves evidence. A required code, assertion, snapshot, gate or dependency change returns to the implementer. |
| Reviewer or read-only diagnosis | Inspects existing evidence, identifies gaps and proposes experiments without editing or executing an implementation plan. |

For the risks that apply, choose controllable readiness conditions instead of a
fixed sleep; give ports, directories, build output and processes explicit
owners; restore global state on success and failure; wait for owned work to
actually stop; and verify an observable result outside the component under
test. A timeout names the awaited state and its budget. Never obtain green by
weakening an assertion, swallowing an error, adding an unexplained retry or
skipping a selected case.

The reverse-proof requirement has the scope defined by
[Test strategy](../../../tests/TEST_STRATEGY.md#反向证明): a new security check,
critical workflow constraint or important race regression. The implementer may
temporarily remove the protection, use the pre-fix source or inject clearly
invalid synthetic input in isolation, observe the expected failure through the
real test entry, then restore the source. Other changes do not gain a mandatory
mutation experiment from this skill.

Keep the first failure with source identity, command, expected and actual result,
logs and running conditions. Classify it as product, test, environment or still
unclassified; a green rerun is not an environment verdict. Reuse evidence only
while its source, baseline, configuration, dependency, environment, command and
artifacts still apply.

Report planned, discovered, executed, passed, failed, skipped and not-executed
counts separately when available; unknown is not zero. Include the first
failure, classification and uncertainty, accessible review summary, local raw
evidence location, remaining gaps and confirmation that owned resources stopped.

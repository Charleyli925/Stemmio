---
name: stemmio-engineering-workflow
description: Route Stemmio planning, verification, implementation and delivery tasks to the applicable evidence-driven lifecycle without expanding their authority. Use for development work and its delivery; not for a general read-only question.
---

# Stemmio Engineering Workflow

Use this skill for a Stemmio development plan, an authorized verification, an
implementation task or later delivery. Choose the task type before choosing the
steps:

| Task type | Apply |
| --- | --- |
| Planning | Investigate current source, produce a reviewable plan and define acceptance evidence. Do not create a branch, edit or deliver unless requested. |
| Verification | Freeze the requested source, run only the authorized checks and report their actual result. Do not turn a failing check into an implementation task without authority. |
| Implementation | Use an isolated worktree, edit the owner, add necessary tests, run the applicable gates, inspect and commit the intended diff, push and open a Draft PR. |
| Later delivery | Continue from the current tested source only as far as the user has authorized under the existing Ready, merge, packaging or release rules. |

[AGENTS.md](../../../AGENTS.md) owns mandatory repository rules,
[Codex workflow](../../../docs/CODEX_WORKFLOW.md#task-lifecycle) owns task stages,
commands and delivery boundaries, and
[Test strategy](../../../tests/TEST_STRATEGY.md#改动类型与证据质量) owns evidence.
Use those sources for policy instead of repeating them here.

For every task, settle the requested outcome, scope, behavior to preserve,
completion standard and authority. Distinguish verified facts, inferences and
open questions, then locate only the owner and contracts needed for the risk.
State the observable acceptance claim and the real entry that will prove or
refute it before implementation.

For implementation, inspect the worktree with `npm run task:status`, use
`npm run gate:plan` to locate capability context, run `npm run gate:edit` while
editing when useful, and run `npm run task:finish` once before publication.
`task:finish` already owns the task gate. Review both unstaged and staged diffs
and publish only intended paths.

Complete routine choices, in-scope repairs and proportionate retesting without
an approval round trip. When a new fact changes agreed behavior, authority,
write scope or acceptance, pause the affected work and send the evidence to the
task owner; unaffected work may continue. Ask the user only when a material
choice or new authorization is actually required. A child reports to the root
agent rather than independently expanding scope or contacting the user.

Output the artifact appropriate to the task type: a plan and acceptance method;
version-bound verification evidence; or a focused implementation with its
tested source, accessible evidence, remaining limits and actual delivery stage.

Do not create a second gate, evidence store, task manager or test scheduler; do
not push to `main`, write in another owner's worktree, add product scope because
a related problem was noticed, or claim completion while required authorized
work remains unfinished.

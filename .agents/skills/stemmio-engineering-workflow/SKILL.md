---
name: stemmio-engineering-workflow
description: Plan, implement, verify and deliver a Stemmio development task on evidence, including preparing the tested Draft PR. Use for development planning, implementation, task verification and delivery; not for read-only questions that change nothing.
---

# Stemmio Engineering Workflow

Trigger: a development task in this repository — planning, implementation,
verification or delivery, including the pre-publication check. A read-only
question that changes nothing does not use this skill.

This skill is the execution method. `AGENTS.md` owns the mandatory rules,
`docs/CODEX_WORKFLOW.md` owns the lifecycle, commands and delivery boundaries, and
`tests/TEST_STRATEGY.md` owns the required evidence. Read those instead of a copy
here.

1. Resolve the active Git root and the working state with `npm run task:status`.
   Work in an isolated task worktree (`npm run task:start -- <prefix>/<name>` or
   `npm run task:attach -- <branch>`) and never stash or mix unrelated user
   changes.
2. Settle the intake facts in writing before editing: outcome, allowed scope,
   behavior to preserve, completion standard and delivery authority
   (`docs/CODEX_WORKFLOW.md` -> `Task lifecycle` -> Intake). Keep a small task to
   a few sentences.
3. Separate verified facts, inferences and open questions while investigating.
   Source proves current behavior; accepted product and security rules define
   required behavior; report any conflict instead of resolving it by assumption.
   Check third-party protocols, dependency and tool capabilities against the
   applicable version's official material rather than model memory.
4. Locate the owning module and its contract through `docs/ARCHITECTURE_MAP.md`
   and `npm run gate:plan -- --context-domain <id>` or `--context-file <path>`,
   then read the matched contract, owners and named sections. Expand only for a
   dependency, failure or contract change.
5. State the acceptance claim before implementing: which behavior must be
   proven, through which real entry point, observing what result, and which
   failure or counterexample would refute it. Surface a missing verification
   capability now instead of after implementation.
6. Implement inside the owning module and pull in the required evidence from the
   change-type table in `tests/TEST_STRATEGY.md`. Run `npm run gate:edit` while
   editing. Report to the user, and continue the unaffected work, when a new fact
   changes the target behavior, a public interface, authority, the write scope or
   the validity of the acceptance.
7. Run `npm run task:finish` once before publication. It already owns
   `gate:task`; do not run both as separate completion gates, and do not add a
   second matrix of your own.
8. Review the unstaged and staged diff, stage only the intended paths, then
   commit, push and open the Draft PR with the evidence bound to the verified
   source and the remaining limits stated. Pre-publication checks live here, not
   in a separate entry.
9. Stop at the tested Draft PR. Ready, packaging, merge and release each need
   their own authorization, and `npm run task:audit` / `task:retire` only apply
   to the exact merged task.

Output: the focused diff, the commands actually run with their results bound to
the verified source, the evidence that was skipped or not executed, and the
remaining limits and delivery stage.

Prohibitions: no second gate, evidence store, task manager or test scheduler; no
direct push to `main`; no writing in a checkout that belongs to another writer;
no product scope added because a problem was noticed along the way; no
completion claim while a required suite is unexecuted, a first failure is
unclassified or an authorized step is still pending.

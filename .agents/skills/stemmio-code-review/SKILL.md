---
name: stemmio-code-review
description: Independently review a Stemmio diff or Pull Request for correctness, regressions, races, scope and verification gaps. Use for Pull Request, code or architecture review; not for implementing the reviewed change.
---

# Stemmio Code Review

Trigger: a request to review a diff, a Pull Request, a module or an architecture
change. Review is read-only and never edits, commits, pushes, changes PR state or
expands authorization.

Read `docs/ENGINEERING_STANDARDS.md` sections `Defense classes`, `Tests`,
`Definition of complete`, `Asynchronous ownership and cleanup`, `Ownership and
commit points`, `Requirements before mechanism`, `Where a limit must be enforced`,
`Interfaces, model input and user-facing copy` and `Defaults, dependencies and
compatibility`, plus the task-specific contract routed by `docs/ARCHITECTURE_MAP.md`
and `AGENTS.md` section `Code Review Rules`. Reuse material already read when the
source has not changed.

1. Read the actual diff — the Pull Request diff, not only the local working tree
   — together with the surrounding current source. A claim in the description is
   not evidence for what the code does.
2. Check that the change is in the owning module and that the ownership and
   contract documents still match the code. A fix in the wrong owner is a finding,
   not a style note.
3. Trace each changed interface to both ends: producer and consumer, schema and
   decoder, prompt and assembled model input, user-facing copy and the program
   that reads it. The program must not parse state out of user copy.
4. Find the entry that produces each limit and check whether the limit can be
   bypassed through a direct call, another legitimate entry, a schema default or
   an awaited precondition that changed. A prompt, a disabled button or a wrapper
   is not enforcement by itself.
5. Follow one operation along input -> execute -> commit -> notify -> clean up.
   Look for publication before commit, a late older result overwriting a newer
   one, several consumers compensating for one producer error, a partial success
   hidden behind one flag, and resources that were asked to stop but never
   confirmed stopped.
6. Judge the evidence: bound to the reviewed source, taken from an observable
   result instead of a component or agent self-report, expectations not
   recomputed by the implementation under test, a new guard or race regression
   proven by a reverse experiment, skipped and unexecuted checks reported as
   such, reused evidence still valid for this source, baseline, configuration,
   environment and command.
7. Classify by verified impact rather than by label, and apply the scope-stop
   rule: verified P0/P1 defects and required deterministic gate failures block
   delivery, while P2/P3 and unclassified findings are recorded for the PR body
   or a follow-up instead of expanding the task.

Output: the reading completed, the reviewed source identity, severity-ordered
findings each with location, trigger, broken requirement, actual impact,
evidence and fix direction — separated into verified defects, unverified
suspicion and optional suggestions — then the verification gaps and limits of
this review.

Prohibitions: no "matches the plan" approval as a correctness verdict; no review
quality measured by comment count; no repeating a formal issue a passing
mechanical check already covers; no edit, no commit, no PR state change and no
new authority from a review, and no skipping an agreed acceptance item under the
scope-stop rule.

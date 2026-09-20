---
name: stemmio-prose-standard
description: Write or review Stemmio engineering documents, owner documents, code comments, decision records and retrospectives without changing the task's write authority. Use for normative prose, rule placement, ADRs and comment quality; not for product-facing copy.
---

# Stemmio Prose Standard

Use this skill when writing or reviewing a normative document, owner document,
code comment, ADR, decision note or retrospective. A writing or modification
task applies edits only within its authorized scope. A review task returns
findings, evidence and suggested text without editing. The skill never changes
the task's write authority.

Read the affected code or owner document and the relevant sections of
[Codex workflow](../../../docs/CODEX_WORKFLOW.md#documentation-decisions-and-retrospectives).
Read [the ADR index](../../../docs/decisions/README.md) and
[ADR curation](../../../docs/ADR_CURATION.md#adr-change-notice) only for ADR or
decision-status work; a small comment or wording change does not require the ADR
corpus. For ADR work, the root agent gives the required user notice before the
change and reports the actual ADR impact at delivery.

Choose one normative home: workflow for stages and delivery, engineering
standards for implementation shape, test strategy for evidence, simplification
audit for audit scope, and an ADR for a durable decision. Other files point to
that owner rather than copying its rule. Keep current requirements, plans,
accepted-but-unimplemented decisions, implemented behavior and retired history
visibly distinct.

Comments preserve only the non-obvious behavior, failure, timing, ownership,
exception or consequence. An ADR records a durable problem, decision, real
alternatives, benefits, costs and reopening condition without rewriting prior
rationale. A retrospective explains why evidence missed an escaped defect and
which regression or owning rule prevents a repeat. Update an owner document
when the implementation makes it inaccurate; otherwise state why it remains
accurate.

For an edit task, output the focused document or comment change and the
documentation impact. For a review task, output the location, evidence, problem
and proposed wording. In both cases, referenced links and section anchors must
resolve. Do not create a parallel rule, note index or workflow, delete history,
or add a process step without a named problem, executor, evidence and gap in the
existing process.

---
name: stemmio-prose-standard
description: Write or review Stemmio engineering documents, owner documents, code comments, decision records and retrospectives. Use when a change touches normative documentation, placement of a rule, ADRs or comment quality; not for product-facing user copy.
---

# Stemmio Prose Standard

Trigger: writing or reviewing a normative document, an owner document, a code
comment, an ADR, a decision note or a retrospective in this repository.

Read `docs/CODEX_WORKFLOW.md` sections `Documentation, decisions and
retrospectives`, `Evidence and reports` and `Documentation impact`;
`docs/decisions/README.md` for the living index; and `docs/ADR_CURATION.md` for
numbering, status and archive rules.

1. Decide the single normative home before writing: process in
   `docs/CODEX_WORKFLOW.md`, implementation shape in
   `docs/ENGINEERING_STANDARDS.md`, test evidence in `tests/TEST_STRATEGY.md`,
   simplification scope in `docs/SIMPLIFICATION_AUDIT.md`, and a long-term
   decision in an ADR. Other documents keep a short pointer, never a second
   full copy of the same rule.
2. Keep the status honest: current requirement, plan, accepted-but-unimplemented,
   implemented and retired must stay distinguishable, and a future plan must not
   read as current behavior.
3. Keep comments to the non-obvious contract — behavior, failure, timing,
   ownership, exceptions and consequences. Remove a comment that restates code,
   narrates the change or repeats the architecture rationale, but never remove a
   limit a maintainer needs.
4. Write an ADR only for a decision with long-term value, with the problem, the
   choice, the alternatives really considered, benefits, costs and the condition
   that would reopen it. When a related ADR exists, record the successor or the
   current status through `docs/ADR_CURATION.md` instead of duplicating or
   rewriting its rationale.
5. Update the owner document in the same change when the code makes it
   inaccurate. If no document changes, state why the existing documentation is
   still accurate.
6. Use a retrospective for prevention: an escaped defect explains why the
   existing evidence missed it and which regression, rule or process step
   catches it next time. A routine bug is not an incident report.

Output: the updated owner document or comment, with the referenced paths and
section names actually existing, plus an explicit statement of what changed and
what deliberately did not.

Prohibitions: no parallel rule text, no new notes or index system beside
`docs/decisions/`, no rewording of an ADR's historical rationale, no deleting
history to hide a superseded decision, and no new workflow step without a named
problem, executor, evidence and a reason the existing steps are insufficient.

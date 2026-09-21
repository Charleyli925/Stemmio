---
name: stemmio-find-simplifications
description: Audit Stemmio for over-design, dead code, duplicated implementations, documentation drift and chain-of-thought leakage, and produce a read-only simplification proposal. Use when asked to find simplifications, dead code, over-engineering, tech debt or redundant docs; not for implementing the removals.
---

# Stemmio Find Simplifications

Trigger: a simplification audit, dead-code hunt, over-design review, doc cleanup
or an equivalent cleanup request.

Task type: read-only review. The only artifact is the proposal document under
`output/`; nothing is deleted or edited in this pass.

Canonical workflow: `docs/SIMPLIFICATION_AUDIT.md` owns the scope table, scan
commands, verification bar, finding categories, guardrails and the proposal
template. Follow it instead of copying its rules here.

1. Confirm the scope with the requester, or take the audit document's default hot
   spots. Cross-check an existing plan or PR before proposing work that is
   already tracked.
2. Scan with the repository's own tools. Use only an installed, pinned dependency;
   do not download and execute an unpinned tool, and remember that a static scan
   is a lead rather than a verdict.
3. Prove the consumer question for each finding: a zero static reference is not a
   deletion verdict until dynamic entries, configuration, persisted data formats,
   schema members and explicit external promises were checked, and a promised
   extension point or security requirement counts as a real requirement.
4. Cost each finding by net maintenance cost across implementation, callers,
   tests, documentation, dependencies and gate friction — not by deleted lines.
5. Check the guardrails before writing: an irreversible authority-boundary
   protection is never proposed for removal without an equivalent protection;
   authored user scripts and fixtures are never classified as dead code; findings
   stay proposals, and the requester decides.

Output: the proposal document at `output/simplification-proposal-YYYY-MM-DD.md`
with reproducible evidence, blast radius, removal cost, rollback, recommendation
and confidence per finding, plus the explicitly-not-proposed list and the
suggested batching.

Prohibitions: no edits, deletions, staging or gate runs that mutate source; no
speculative finding kept past verification; no whole-repository governance
started from one audit; no second audit workflow outside
`docs/SIMPLIFICATION_AUDIT.md`.

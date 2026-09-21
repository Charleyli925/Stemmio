---
name: archive-decision-notes
description: Curates Stemmio's docs/decisions ADR directory by future value — detects numbering collisions and gaps, classifies each ADR as living contract, historical snapshot, or superseded, and maintains a status index. Use when the user asks to curate, archive, audit, or clean up ADRs, decision records, decision notes, or the docs/decisions directory.
---

# Archive Decision Notes

Trigger: the user asks to curate, archive, audit, or clean up ADRs or `docs/decisions`.

Task type: Steps 1–3 are **read-only**. Step 4 applies index and status changes only after explicit approval and a task branch.

Canonical workflow: read [docs/ADR_CURATION.md](../../../docs/ADR_CURATION.md) and follow it exactly. That document owns numbering-health checks, Living / Historical / Superseded classification, report format, index template, and guardrails. Do not copy those rules here.

Repository entry: [.agents/skills/stemmio-prose-standard/SKILL.md](../../../.agents/skills/stemmio-prose-standard/SKILL.md) owns the documentation and decision-record conventions that this task follows. This file stays a short Qoder-facing pointer to the same single method; it never becomes a second full copy.

Output: `output/adr-curation-YYYY-MM-DD.md`. Applying changes is a separate implementation task.

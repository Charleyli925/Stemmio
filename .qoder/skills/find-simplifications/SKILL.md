---
name: find-simplifications
description: Audits the Stemmio repository for over-design, dead code, duplicated implementations, documentation bloat/drift, and chain-of-thought leakage, then produces an evidence-based simplification proposal document. Use when the user asks to find simplifications, dead code, over-engineering, tech debt, redundant docs, or requests a cleanup/simplification audit.
---

# Find Simplifications

Trigger: the user asks for a simplification audit, dead-code hunt, over-design review, doc cleanup, or similar.

Task type: **read-only review**. Do not implement removals in this pass.

Canonical workflow: read [docs/SIMPLIFICATION_AUDIT.md](../../../docs/SIMPLIFICATION_AUDIT.md) and follow it exactly. That document owns the scope table, scan commands, verification bar, proposal template, and safety classification. Do not copy those rules here.

Repository entry: [.agents/skills/stemmio-find-simplifications/SKILL.md](../../../.agents/skills/stemmio-find-simplifications/SKILL.md) is the shared skill for this task. This file stays a short Qoder-facing pointer to the same single method; it never becomes a second full copy.

Output: `output/simplification-proposal-YYYY-MM-DD.md` only.

# Simplification Audit Workflow

A periodic, read-only audit that turns invisible tech debt into a formal, evidence-based proposal. This workflow is agent-agnostic: any coding agent (or a human) can execute it by following this document. The audit itself never deletes or edits anything; its only output is one proposal document. Acting on accepted proposals is a separate task that follows the standard AGENTS.md lifecycle (`task:start` branch → Draft PR).

## Workflow

```
Audit Progress:
- [ ] Step 1: Pick scope
- [ ] Step 2: Scan for findings
- [ ] Step 3: Verify each finding against current code
- [ ] Step 4: Write proposal to output/
```

### Step 1: Pick scope

Ask the requester, or default to a full pass over these hot spots (ordered by expected yield):

| Area | What to look for |
| --- | --- |
| `app/workbench.tsx` and `app/workbench/` | God-file growth, effects/state that belong in `app/application/` per `docs/STATE_OWNERSHIP.md`; cross-check the current architecture map, ownership, contract and living ADR index before proposing work. `docs/WORKBENCH_ORCHESTRATION_REFACTOR_PLAN.md` is historical rationale and known-risk context, not a pending-plan source |
| `scripts/` | Scripts not referenced by any `package.json` script, CI workflow, or other script; single-use scripts whose purpose has expired |
| `scripts/check-architecture.mjs` | String/substring assertions validating runtime coordination (`docs/ARCHITECTURE_CONTRACT.md` reserves source-string tests for packaging/dependency/security only) |
| `shared/` vs `scripts/` vs `desktop/` | Same-named or near-duplicate modules — verify re-export vs true duplicate before flagging |
| `docs/` | Plan/PRD documents describing completed or abandoned work; contracts contradicting current code; two documents owning the same contract |
| `app/lib/`, `app/domain/` | Exports never imported; compatibility branches whose old format no longer exists in any fixture or schema |
| `package.json` scripts | Entries no CI workflow or documentation references |

### Step 2: Scan

Useful commands (run from the repository root):

```bash
# scripts/ entries never referenced anywhere
for f in scripts/*.mjs; do n=$(basename "$f"); c=$(rg -l "$n" --glob '!node_modules' | grep -v "^scripts/$n$" | wc -l); [ "$c" -eq 0 ] && echo "UNREFERENCED: $f"; done

# doc references to files that no longer exist
rg -o '`[a-zA-Z0-9_./-]+\.(mjs|tsx?|json)`' docs/ -N | sort -u   # then spot-check paths

# chain-of-thought leakage / change-narrative in docs (see categories below)
rg -n -i "we (tried|initially|then decided)|previously" docs/

# dead exports (optional, one-off): only with a tool the repository already
# provides through a pinned dependency, never a temporary download
npx --no-install knip 2>/dev/null || echo "knip unavailable; fall back to rg per-export"
```

A static scan is a lead, not a verdict: "no reference found" never becomes
"safe to delete" on its own. Confirm the consumer question below before a
finding enters the proposal.

### Step 3: Verify

Every finding must survive verification before entering the proposal — no speculative entries:

- **Dead code**: confirm zero references including dynamic ones (`rg` for the bare name, not just import statements; check CI workflows in `.github/workflows/`). Continue past static search into dynamic entries, configuration, persisted data formats, schema members and explicit external promises; only a real consumer removes an item from the zero-reference result.
- **Duplication**: diff the two implementations; if they diverge, the finding is "divergent duplicate" (higher risk, higher value).
- **Doc drift**: quote the documentation sentence and the contradicting code, both with file paths.
- **Over-design**: identify the concrete cost (lines maintained, callers, tests, documentation, dependencies, gate friction, cognitive load), not aesthetic preference. Net maintenance cost decides, not the number of deleted lines.

### Step 4: Write proposal

Write to `output/simplification-proposal-YYYY-MM-DD.md` (gitignored) using the template in the appendix below. Every finding gets: evidence, blast radius, removal cost, rollback plan, recommendation, confidence. End the report with a one-screen summary table sorted by value/effort.

## Finding categories

1. **over-design** — mechanism heavier than the problem (extra abstraction layers, gates checking things that cannot break)
2. **dead-code** — unreferenced files, exports, npm scripts, CI steps
3. **duplication** — same logic in two places, especially `shared/` vs `scripts/` vs `desktop/`
4. **doc-drift** — documentation contradicting current code, or two documents owning one contract
5. **doc-bloat** — completed plan documents, expired PRDs that should be marked historical
6. **cot-leakage** — change narrative, review traces, "we tried X then Y" reasoning residue in documents that should state only the current contract

## Guardrails (non-negotiable)

- **Read-only.** The audit never deletes, edits, or stages anything. The proposal document in `output/` is the only artifact.
- **Never propose deleting** an irreversible authority-boundary protection
  (commit-time stale-hash, identity, registry, AI complete-HTML/Hash, Version
  adoption, destructive delete, published Tree binding) unless an equivalent
  protection remains. Reversible interaction, presentation and preflight
  blocks may be proposed for post-validation, automatic repair or degradation
  when tests and a recovery path exist; record them in `docs/GUARD_LEDGER.md`.
  Product invariants in AGENTS.md and security/packaging string assertions
  stay in force.
- **Never classify authored user scripts or fixtures as dead code** — synthetic fixtures under `fixtures/` and `tests/fixtures/` are referenced by schema/compat tests in non-obvious ways; verify via test runs, not grep alone.
- A planned-but-unfinished refactor is **not** a finding; duplicating an existing plan wastes everyone's time. Cross-check `docs/` plans first.
- Findings are proposals, not verdicts. The requester decides; deviation from a proposal needs no justification.

## Appendix: proposal template

```markdown
# Simplification Proposal — {YYYY-MM-DD}

> Generated by the simplification audit workflow. Read-only audit; nothing has been changed.
> Scope: {areas scanned} · Baseline: {git rev-parse --short HEAD} on {branch}

## Summary

| # | Category | Finding (one line) | Value | Effort | Risk | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |

Value: High/Med/Low · Effort: S/M/L · Risk: Low/Med/High

## Findings

### Finding 1: {short title}

- **Category**: over-design | dead-code | duplication | doc-drift | doc-bloat | cot-leakage
- **Evidence**: {file:line references, quoted code/doc sentences, reference-count results — must be reproducible}
- **Why it costs us**: {concrete cost: lines maintained, gate friction, contradiction risk, reader confusion}
- **Blast radius**: {what depends on this; which tests/gates/docs are touched by removal}
- **Removal cost**: {estimated diff size; which tests must be updated; doc updates required in the same PR}
- **Rollback**: {how to restore if the removal turns out wrong — usually `git revert`; note anything that is not}
- **Recommendation**: {remove / consolidate into X / mark historical / rewrite as contract / no action, monitor}
- **Confidence**: High (verified end-to-end) | Medium (verified statically) | Low (needs owner input)

## Explicitly not proposed

{Things scanned and deliberately left alone, with one-line reasons — prevents re-auditing the same ground next time.}

## Suggested batching

{Group accepted findings into 1–3 focused PRs, each independently revertable. Doc-only fixes batch together; code removals stay separate.}
```

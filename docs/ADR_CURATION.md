# ADR Curation Workflow

Curates `docs/decisions/` so the directory stays a navigable knowledge base instead of an append-only pile. This workflow is agent-agnostic: any coding agent (or a human) can execute it by following this document. Curation means **status marking, indexing and moving clearly superseded ADRs into `docs/decisions/archive/` — never deleting or rewriting their rationale**. An ADR's text is a historical record; only its metadata (status header, index entry, filename in a numbering collision, and archive location) may change.

## ADR change notice

Before adding, editing, renaming, changing the status of or archiving an ADR,
the root agent tells the user which ADR number and file are involved, what will
change, why, and whether the existing decision changes. Do not repeat an
approval request for the same change when the user has already seen and
authorized it. Give a new notice when execution expands the scope or changes the
decision.

An unapproved architecture decision, replacement of an existing decision, or a
status/index/archive operation that this workflow requires the requester to
approve waits for explicit authorization. A mechanical edit already inside the
authorized scope proceeds after notice without stopping for approval on every
line.

Accepted ADRs keep their historical reasoning and rejected alternatives. Change
a decision through a new proposal or successor ADR, never by rewriting the old
body to make the history appear continuous. The Pull Request and final delivery
list each actual ADR change and its impact; a proposed but unimplemented change
is marked pending. A child agent reports ADR implications to the root agent, who
owns the user notice.

## Workflow

```
Curation Progress:
- [ ] Step 1: Inventory and numbering health
- [ ] Step 2: Classify every ADR by future value
- [ ] Step 3: Write curation report to output/
- [ ] Step 4 (on approval): apply index + status changes and archive moves via task branch
```

### Step 1: Inventory and numbering health

```bash
ls docs/decisions/ | sort
# collisions: same 4-digit prefix twice; gaps: missing numbers in the sequence
ls docs/decisions/ | grep -oE '^[0-9]{4}' | sort | uniq -d   # collisions
```

For each **collision**, decide the fix by checking references first:

```bash
rg -n "00XX" --glob '!node_modules' --glob '!docs/decisions/00XX-*'
```

- Colliding files are resolved by renaming the later decision to the next number above the recorded historical maximum. References are updated in the same change and the renamed ADR gets a one-line collision note. Renames preserve git history; use `git mv`.
- The historical maximum is monotonic. Never fill a gap such as `0020`, even when it is currently unused.

**Gaps** are recorded in the index as "number never used" — never backfill a gap with a new ADR; new ADRs always take `max + 1`.

### Step 2: Classify by future value

Read each ADR and assign exactly one status. For LIVING candidates, spot-verify at least one claim against current code before assigning — an ADR describing removed code is not living.

| Status | Meaning | Test |
| --- | --- | --- |
| **LIVING** | Accepted and still constrains current or planned implementation | A PR violating it should be rejected; an accepted-but-unimplemented decision remains living and is labelled as such |
| **HISTORICAL** | The decision shaped the codebase but no longer guides new work | Context is past; nothing enforces it; deleting it loses history, not guidance |
| **SUPERSEDED** | A later ADR or contract document replaced it | Name the successor explicitly |

Signals for SUPERSEDED: a later ADR covers the same subsystem with a different conclusion; the mechanism it mandates was replaced (verify with `rg` for the named modules); a contract document (`docs/ARCHITECTURE_CONTRACT.md`, `docs/STATE_OWNERSHIP.md`) now owns the rule.

The absence of current code is not evidence that an accepted but explicitly
unimplemented decision is historical or invalid. Classify it from its approval
and successor status, and keep its implementation state visible in the index.
When unsure between LIVING and HISTORICAL, mark LIVING and flag it in the report
for the requester — false-historical is the expensive mistake. An ADR explicitly
marked **Superseded** is archived after its successor is verified; a partially
amended section does not justify moving the whole ADR.

### Step 3: Curation report

Write `output/adr-curation-YYYY-MM-DD.md` containing:

1. Numbering health: collisions with proposed resolution (rename vs annotate, with reference evidence), gaps, next free number
2. Status table: number · title · proposed status · one-line justification · verification evidence for LIVING/SUPERSEDED calls
3. Draft of `docs/decisions/README.md` using the index template in the appendix below
4. Exact file operations required (`git mv` commands, header lines to add), so the apply step is mechanical

### Step 4: Apply (only after explicit approval)

Apply exactly the approved operations from the report on an isolated task
branch. Run the applicable ADR checks, including `npm run adr:check`, then follow
the standard implementation, verification and delivery lifecycle in
[Codex workflow](CODEX_WORKFLOW.md#task-lifecycle). Do not maintain a separate
ADR-specific command sequence. Changes allowed:

- Create/refresh the active `docs/decisions/README.md` and historical `docs/decisions/archive/README.md` indexes
- Add one status line under a superseded ADR's title: `> Status: Superseded by [ADR-00YY](00YY-....md)`
- `git mv` for approved collision renames and explicit archive moves, plus updating any in-repo references in the same commit
- Add only the collision note and required successor metadata; do not delete, rewrite or reformat an ADR body.

## Guardrails

- **Never delete an ADR.** Archived files remain in `docs/decisions/archive/` with their rationale intact.
- **Never rewrite ADR content** — rationale and rejected alternatives are the point of an ADR; trimming them destroys its value.
- **Numbers are monotonic once assigned.** Rename only the later side of a collision, and use a number above the historical maximum.
- **The active index is the default reading path.** Historical investigation follows the archive index explicitly.
- Steps 1–3 are read-only; Step 4 requires the requester's explicit go-ahead and follows the standard branch/PR lifecycle.

## Appendix: index template

```markdown
# Architecture Decision Records

> Index maintained by the ADR curation workflow (`docs/ADR_CURATION.md`). Statuses: **Living** (still constrains new code) · **Historical** (shaped the codebase, no longer guides new work) · **Superseded** (replaced — see successor).
>
> New ADRs take the next free number: **{next-free-number}**. Never reuse a gap number.

## Numbering notes

{Collision/gap notes.}

## Index

| # | Title | Status | Successor / Note |
| --- | --- | --- | --- |
| 0001 | [{title}]({file}) | Living | |
| 0002 | [{title}]({file}) | Historical | |
| 0003 | [{title}]({file}) | Superseded | → [00YY]({successor-file}) |

## Reading guide

- Implementing a change? Read the **Living** rows touching your subsystem before coding.
- Investigating "why is it built this way"? **Historical** and **Superseded** rows hold the context.
```

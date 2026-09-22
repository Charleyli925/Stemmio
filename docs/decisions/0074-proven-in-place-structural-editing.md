# ADR 0074: Proven in-place structural editing

- Status: Accepted
- Date: 2026-09-14
- Relates: [ADR 0062](0062-semantic-source-operation-kernel.md),
  [ADR 0064](0064-stable-id-source-structure-editing.md),
  [ADR 0065](0065-disposable-edit-runtime.md),
  [ADR 0072](0072-source-receipts-fence-canvas-authority.md)

## Context

PR #502 proved that some Runtime rebuilds were unnecessary and eliminated
those cases. It did not prove that the remaining 140 structural rebuilds were
all unnecessary. Those 140 `copy-edit-delete-element` rebuilds stayed as the
safe default. Same-parent reorder already has a proven in-place path.

Users still lose iframe identity, author-program continuity and reading
position on ordinary source copy, delete, insert and supported moves. Removing
the structural Candidate branch without a grant path would insert a copy that
cannot be edited: ADR 0065 seals the Runtime source-object set before author
scripts run, so a new DOM node cannot gain edit authority merely by carrying a
  valid `data-stemmio-id`. This ADR therefore distinguishes the narrow direct
Canvas command surface from shared semantic operations used by history and
recovery.

## Decision

Structure edits default to attempting an in-place Canvas projection. Only when
source identity, current node identity and the local update result are all
proven may the current iframe be reused. New direct Canvas commands are
admitted only for the narrow policy scope below; if their plan would require a
Candidate, they are rejected before a source receipt. Existing history,
authority replacement and accepted-source recovery retain the Candidate path.

### A. In-place is a projection strategy, not a source channel

Every operation still runs:

SemanticOperationKernel → complete next HTML → existing source receipt and
history → existing persistence.

The Canvas only presents an already accepted source result. Runtime DOM is
never serialized as the save result. Local DOM mutation cannot bypass the
kernel. One accepted edit materializes HTML once; preparing an in-place plan
must not run a second source edit.

### B. Editor-created nodes may receive a controlled grant

Author code still cannot extend the trusted node set. Only Stemmio itself,
from one accepted semantic source transaction, may grant this generation's
edit authority to the exact nodes it created.

| Object | Authority |
| --- | --- |
| Author-script generated node | None. Display/comment-only. |
| Editor-created node from this accepted transaction | May be granted through the parent-owned `RuntimeSourceElements` owner after identity, frame and local-structure proofs. |

This is not a reopened initialization registry and not a scan of the live DOM
for legal IDs. The executor seals the exact `Node` objects it created from the
next source HTML *before* they connect. After `insertBefore`, grant may verify
only that sealed ticket; a later `querySelector` of the live tree cannot
nominate replacements. Duplicate, stale-frame, old-Document, forged-ID,
disconnected, extra-identity and author-created same-ID objects fail closed.

Customized built-in elements (`is="…"`) and autonomous custom elements are
rejected by the direct command policy: a `div` with `is` is still a `div` by
tag name, but its `connectedCallback` can replace children with author clones
that carry the legal IDs. Mixed-content parents that contain non-whitespace
text or comments are likewise rejected for direct copy/delete/move, because
element-sibling placement and exact undo cannot prove the text/comment
boundary. Internal history/recovery may still use the Candidate path.
`html`/`head`/`body` remain
non-targets for delete/move of themselves; `body` may be a proven destination
parent for ordinary source children. `html` and `head` may not.

Frozen support matrix for this round:

| Host / parent | Direct copy / insert / move | Direct delete |
| --- | --- | --- |
| Safe `p` / heading / simple `li` / inline `blockquote` under a plain parent | In-place | n/a |
| Static, script-free text `div` with only safe inline descendants under a plain parent | In-place | n/a |
| Ordinary source subtree with a provable delete/undo boundary | n/a | In-place; selection may clear when no legal landing remains |
| `body` as destination parent | Same-parent move of ordinary children only; no direct insert entry | n/a for `body` itself |
| Mixed text/comment parent | Reject | Reject |
| `is="…"` or autonomous custom element | Reject | Reject |
| Table/SVG/script and other unsupported tags | Reject | Reject |

Pre-mutation proof binds the current Document, current Runtime authority and
the *before* SourceIndex. Post-mutation proof binds the accepted after-index,
the actual local result and any new grant. The live `sourceIndexRef` is not a
proof input; advancing it must not unprove a still-connected delete target.

Observation attributes distinguish the plan from the result:
`data-structural-projection-kind` is the plan, and
`data-structural-projection-outcome` is `in-place`, `candidate` or `recovered`.
A planned in-place that later recovers must not be counted as an in-place
success.

### C. Distinct failures stay distinct

| Situation | Outcome |
| --- | --- |
| Source preconditions fail, target identity is untrusted, or a new direct operation is outside policy | **Reject.** Source and history stay unchanged. |
| A retained internal/history operation is legal but in-place proof is incomplete | **Accept** the source operation and use the existing **Candidate** rebuild. |
| Source is already accepted and later in-place projection fails | Keep accepted source and history; enter **Canvas recovery**. Do not claim the edit was rejected. |

Untrusted target identity must not become “rebuild and try again”. Rebuild
cannot launder a permission check.

### D. Conservative compatibility

In-place does not promise that arbitrary author JavaScript re-initializes
correctly. Ordinary, proven source regions prefer in-place. Regions that need
author-program re-init, cleanup, or currently unprovable behavior keep
rebuilding.

Do not add JavaScript dependency analysis, listener guessing, author-activity
freeze, Runtime snapshot restore, or per-node Runtime/source reconciliation.
Those mechanisms stay retired.

### Scope

The direct Canvas/command scope is intentionally narrower than the shared
semantic kernel: safe authored text-block duplicate, including static,
script-free text `div` elements with non-empty text and safe inline descendants, deletions with a provable source
delete/undo boundary (with an optional selection landing), supported same-parent
adjacent reorder, and the matching Undo/Redo. The `div` extension retains all
identity, reference, resource, event-handler, ancestor and mixed-content guards;
documents with authored scripts, event attributes or navigation/load URL attributes
(`href`, `xlink:href`, `src`, `action`, `formaction`, `object[data]`) whose WHATWG-parsed scheme is
`javascript:` or `vbscript:` anywhere remain outside this direct category.
Arbitrary HTML insertion and cross-parent move are not direct product commands.
Duplicate continues to reuse the shared `createInsertElementOperation` primitive;
there is no second public copy protocol. The shared insert/move primitives remain
available to history, recovery and other controlled internal consumers.

Out of this round by default: `replaceSubtree`, whole-document source replace,
script/resource-closure/program-identity changes, and authority receipts.
Authority receipts still advance Canvas generation and reload the physical
frame, including same-byte authoritative reloads (ADR 0072).

### Projection plan

An operation-local `StructuralProjectionPlan` may exist only for the current
command. It is not a persistence model, history record, or public semantic
field. A `VerifiedStructuralProjectionPlan` is produced only by internal
verification; a caller cannot obtain in-place rights by passing `safe: true`.

### Product loop

For ordinary, source-traceable content the user can:

copy → edit the copy → change style → move → delete → undo →
edit the restored object → restore the baseline → redo to the saved
restored state → save and reopen

while keeping the current iframe `Document` identity whenever the proofs
succeed. New and restored objects remain legally editable. The frozen
`core-structure-closed-loop` harness records that product loop against a
reviewed leaf, a frozen destination parent and independent projection
expectations. Delete keeps the existing explicit confirmation. Selection after a confirmed delete lands on
the next eligible source sibling, else the previous, else a legal parent,
else clears. Comments on deleted IDs become orphaned by existing Stable ID
rules.

## Consequences

- Same-parent reorder keeps its current in-place end state.
- Proven structural local-edit and history receipts may reuse the physical
  frame; authority receipts do not.
- Tests must distinguish reject (no source/history/DOM change), accepted
Candidate rebuild, and accepted-then-recover. Harness expected groups are
frozen independently of the product's plan label:

| Group | Requirement |
| --- | --- |
| Must in-place | Safe direct copy/delete and same-parent adjacent move. Candidate labelling cannot lower the bar. |
| Must rebuild | Authority replace, program-identity change, and currently unprovable hosts. |
| Must refuse | Illegal targets, wrong identity, cyclic moves. Source and history stay unchanged. |
| Recover after accept | Injected local projection failure keeps accepted source and history. |

`data-structural-projection-kind` is the plan;
`data-structural-projection-outcome` is the result. Rebuild counts use actual
Document replacement, not plan events. #502's remaining 140 rebuilds are a
baseline, not a requirement to zero every structural rebuild a priori.

# Engineering standards

This document is normative for implementation shape. Product requirements
still come from the routed product documents; architecture and state ownership
come from `ARCHITECTURE_MAP.md`, `ARCHITECTURE_CONTRACT.md` and
`STATE_OWNERSHIP.md`. Defense class and user-visible blocks are recorded in
`GUARD_LEDGER.md`.

## Defense classes

Classify a failure by whether it is irreversible. P1-A (#191) is the
presentation template: enter native editing first, then validate with stale
hash, patch scope and MutationObserver rollback. Notification policy
`silent-recover` is the reversible-coordination template. P1-B CAS is the
authority-boundary template: one verified realpath cache per `#serial()` turn,
re-checked on the next turn.

### Authority boundary — fail-closed

Wrong-disk writes, mistaken AI adoption, wrong Version activation, destructive
deletes and wrong published packages. Validate the same fact at most three
times: at ingress, after an external await, and immediately before irreversible
commit. Do not re-normalize, realpath, hash and compare in every function.
`Verified*Context` objects live only inside one operation; they are not a
Session or Registry authority.

### Reversible coordination — converge automatically

Stale queries, expired Canvas acknowledgements, catalog refresh failures,
rebuildable projections and Bridge replies that can be reread. Discard the old
result, reread authority, rebuild, retry once within a bound, or degrade. Do
not show a dialog, lock the canvas, or ask the user to retry an internal
uncertainty. An unknown mutation queries authority before retry; a bounded
retry that cannot change the precondition is a loop, not recovery.

### Presentation and edit eligibility — fail-open

Layout preflight, hover/outline trust, Review annotation projection,
comment-marker location and UI projection lag. Let the user continue. Enter
edit first.
Keep a comment whose target failed outside an explicit source-element delete,
mark its location as lost, and offer the delete-and-comment-again recovery path.
Hide a failed outline; do not forbid editing.

User confirmation is reserved for deleting a project or source element, discarding edits that
cannot be autosaved, explicitly overwriting an external change, and
unrecoverable identity or permission changes. Lasting content-safety states
use existing workspace banners via `WorkspaceSafetyState`. Generic `setToast`
is retired: do not add `setToast({...})`, a new `NoticeBar`, or free-form
`background-result` copy. Allowlisted interruptions must name a closed
`GlobalInterruption` kind. Classify or delete an existing site in
`scripts/notice-disposition-ledger.json`. Do not invent replacement error UI
to retire a Notice.

Do not remove an irreversible authority-boundary protection unless an
equivalent protection remains. Reversible interaction, presentation and
preflight blocks may move to post-validation, automatic repair or degradation
when tests and a recovery path exist. Record the decision in `GUARD_LEDGER.md`.

Line-count ceilings in `scripts/architecture-budget.json` are observational.
They are not an acceptance goal. Do not split a file only to lower `maxLines`.

### Validation placement

Place validation where the fact is owned and the limit can actually be enforced:

- Same-process parameters that already satisfy the type and ownership contract
  are not re-validated as hostile input.
- Parsing, configuration, queues, model output, persistence, worker, subprocess
  and network input need their own validation.
- A type assertion is not validation.
- A permission, identity or version precondition that can change across an
  `await` cannot stay valid forever because it was checked earlier.

Concentrating each check in its owner is not a licence to re-validate the same
fact in every layer.

## Prefer invariants over patches

Before adding a guard, retry, ref, effect or compatibility branch, write down:

1. the mutable fact and its sole owner;
2. the invariant that was violated;
3. the command/query outcome (`acknowledged`, `rejected` or `unknown`);
4. the late-response and crash behavior;
5. the close, switch, submit and history drain impact.

A branch that cannot name these five items is not a safety mechanism. It is
unowned state and must not be added.

Fix the producer or ownership boundary first. Do not compensate for an invalid
state independently in several consumers. When a new invariant replaces an
old workaround, remove the workaround and its implementation-shape test in the
same Pull Request.

## Modules and abstractions

An abstraction is justified only when it removes a responsibility from its
caller and has a stable contract that can be tested without reading the
caller's source. A wrapper that forwards the same parameters, adds no invariant
and leaves all decisions in the caller is prohibited.

- Use one options object at infrastructure boundaries; do not thread unrelated
  booleans through several layers.
- Prefer a small state machine or aggregate command over many coordinated
  refs.
- Keep compatibility decoding at the ingress. Current domain/view code never
  branches on retired names.
- Keep I/O at adapters and repositories. Domain transitions are pure.
- Keep generated identifiers, revision checks, idempotency and rebase policy in
  the owning command/session, not in a React effect.

Large source-fidelity engines are not split merely to reduce line count. A
split must create a real invariant boundary and preserve byte, Selection, IME
and transaction coverage. Prefer a narrow command interface and mutually
exclusive view-model states over another file cut. New product persistence or lifecycle behavior may
not be added directly to `workbench.tsx`, `HtmlCanvasEditor.tsx`,
`IslandEditingController.ts` or `workspace-bridge.mjs`; first introduce or use
the owning application/domain/service module. The retired V1 controller and
its tracker/draft/planner modules are deleted and forbidden by the architecture
gate; they are not compatibility or extension points.

## Effects and asynchronous work

React effects may connect DOM, subscriptions and timers. They may request work
from an owner, but may not implement CAS, retries, merge policy or lifecycle
aliases.

Every async query carries full project/session identity and a monotonic
sequence. Every mutation carries an operation ID and precondition. Unknown
mutation outcomes query authority before retry. A bounded retry that cannot
change the precondition is a loop, not recovery.

Do not represent “not registered yet” with an otherwise valid context whose
identifier fields are empty strings. Model a locator and a registered context
as different states. Any transition that creates or adopts project identity
must initialize every dependent session from the same authoritative response;
setting React identifiers without binding the Draft session is incomplete.

## Asynchronous ownership and cleanup

One asynchronous operation has one lifecycle owner. An extra cancel, ready,
retain or ended state needs its own responsibility and end point; it must not
restate a fact an existing state already owns. Keep the rollback, the
first-terminal decision, callback-exception isolation and resource ownership the
operation actually needs.

“Stop requested” is not “stopped”. Cleanup stops new work, isolates late
callbacks and waits until the processes, connections or tasks it owns have
actually ended.

## Ownership and commit points

An important interface defines more than who owns the state: when new facts are
accepted, when a notification may be published, and which facts already hold
after a failure. Different outcomes stay independently expressed; one generic
success flag does not hide partial completion, an unknown result or unfinished
cleanup.

Review one operation along its whole path — input, execute, commit, notify,
clean up — and look for publication before commit, a late older operation
overwriting a newer result, and several consumers each compensating for the same
error instead of the producer fixing it.

## Requirements before mechanism

An abstraction, public method, state machine, configuration option, defensive
copy or compatibility branch names its current consumer, its owning module and
the responsibility it removes. “Might be needed later”, “more general” and
“safer” are not requirements. A small call-site count is not by itself a removal
argument either: an explicit external extension promise, a persisted format or a
security requirement is also a real requirement.

Judge a simplification by net maintenance cost across implementation, callers,
tests, documentation and dependencies, not by the number of deleted lines.
Scope, consumer proof and proposal format live in `docs/SIMPLIFICATION_AUDIT.md`.

## Where a limit must be enforced

A permission, refusal condition, write precondition or operation limit is
verified at the entry that produces the effect. A prompt, a disabled button, a
hidden schema field, a thin wrapper and the expected call order do not by
themselves prove the limit cannot be bypassed; check the direct call and the
other legitimate entries as well.

Enforcing in the owner is not permission to repeat the same check in every
layer; `### Validation placement` says which inputs need their own validation.

## Interfaces, model input and user-facing copy

When a public interface, prompt, tool schema, result or diagnostic changes,
state separately what the program, the model and the user each need.

- The program never parses state or identifiers out of user-facing copy.
- A model interface carries no unrelated UI or implementation vocabulary.
- User copy never describes an unconfirmed result as completed.

A model-visible change is checked on the assembled input or output, not on one
template. For behavior an external system cannot observe, state the evidence
limit instead of claiming more.

## Defaults, dependencies and compatibility

A public default or configurable option carries a current requirement or a
reliable source. Without one, prefer an explicit input or defer the decision
instead of adding configuration that hides an unmade decision.

Using a built-in capability or a mature dependency means checking the applicable
version, its maintenance, size, transitive dependencies and security
requirements. Do not trade own code for a larger hidden maintenance surface.

Internal APIs, on-disk data and external protocols are decided separately: an
unstable internal interface does not excuse dropping data support that was
already promised, and a compatibility layer is not kept forever for unknown
historical states.

These are design and review requirements. They do not authorize a scan that
rewrites the repository, and they do not change any current authorization,
gate or release boundary.

## Tests

Prefer observable outcomes:

- exact source bytes and Hashes;
- revision and operation identity;
- durable records after restart;
- state-machine transitions and late-response rejection;
- close/switch/submit/history behavior under injected failure.

Source-string assertions are limited to security, packaging, dependency and
explicit architecture boundaries. Moving code behind a better owner should
move the test to that owner's public behavior instead of preserving the old
file shape.

Every new owner or protocol must be listed in `STATE_OWNERSHIP.md`, mapped in
`tests/test-impact-map.json` and covered by `npm run architecture:check`.

## Definition of complete

A state or architecture migration is complete only when:

- one owner is active and all former writers are removed;
- old aliases/workarounds exist only in one documented compatibility adapter;
- current PRs and local changes that touch the same boundary are incorporated
  or explicitly proven independent;
- behavior, failure, restart and packaging coverage pass;
- normative docs and impact mapping match the code;
- no temporary dual-write, TODO migration path or untracked generated artifact
  remains.

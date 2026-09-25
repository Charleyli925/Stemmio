# ADR 0065: Edit runs supported author scripts in a disposable source-bound page

- Status: Accepted
- Date: 2026-08-30
- Supersedes: [ADR 0025](archive/0025-edit-direct-one-shot-runtime.md), [ADR 0058](archive/0058-bounded-canvas-svg-edit-runtime.md), and the prewarm/freeze/Runtime-cache portions of [ADR 0054](0054-bundled-echarts-and-five-canvas-residency.md). The verified immutable byte-store portion was restored on 2026-09-01 without restoring Runtime state.
- Does not change: Preview isolation, Review's static-source facts, or complete-HTML persistence

## Context

The one-shot Edit runtime admitted only visually classified ECharts, Canvas and
SVG programs. It then tried to detect paint, wait for quiet frames, freeze
timers and listeners, audit runtime mutations against source hosts and retain a
single settled iframe. That contract made ordinary Script pages unavailable in
Edit and made every semantic source change participate in a second runtime
reconciliation system.

Stable source-element IDs and complete-HTML semantic operations now provide the
durable identity and save boundary. Runtime DOM no longer needs to impersonate
source or be reconciled node by node.

## Decision

- A persisted desktop document with a supported executable `script` program may
  use the direct Edit runtime. The visible iframe first parses the complete
  source with authored scripts inert, proves the parser-authored source object
  set, and then activates those scripts in source order. PageRoot does not stop
  timers, listeners, observers, animations or message ports after activation.
- Main verifies the active source path, exact HTML Hash, Canvas generation and
  resource budgets before preparing a scoped `pageroot-edit-runtime:` resource
  closure. Inline and contained local scripts are supported. Exact reviewed
  ECharts 5.4.3 and 5.6.0 CDN URLs may resolve only to their same-version,
  SHA-pinned packaged bytes. Module import
  graphs remain unsupported and fail closed to an explicit static Edit state.
  Main admits at most two concurrent preparations and retains only a bounded
  recent request-ID replay window. Completed identities age out; ordinary use
  cannot exhaust a permanent application-lifetime budget or require a restart.
  Workers stay
  CSP-disabled because worker bytes are outside the frozen author-script
  closure and its Hash/budget checks.
- Exact-version allowlisted ECharts core bytes may be retained in a bounded,
  content-addressed Main store. Reviewed 5.4.3 and 5.6.0 core URLs use their
  exact packaged versions without network or compatibility substitution. Other
  immutable versions use only an exact cache hit or the exact bounded network
  request. Version, filename and query identity remain fixed across redirects
  before bytes enter the store; a missing or corrupted packaged pin fails
  closed instead of silently switching version.
- Before author scripts execute, the fixed bootstrap opens one parent-owned
  registration capability. The parent editor deletes that entry after the
  bootstrap captures its private batch and activation-result ports, each bound
  to the source window, session, execution and frame token. Once parsing reaches the complete
  document, while every author-script placeholder is still inert, the bootstrap
  registers the complete parsed set once and only then activates author
  programs. Script resource/bootstrap failures reject the Candidate. A
  synchronous author error or immediate unhandled rejection instead reports a
  partial activation: it may remain editable only after required source-host
  runtime-generated critical content is ready. A static authored SVG is not
  readiness proof; recognized ECharts must expose its live instance. Iframe load
  alone never reports success. An early
  authored script therefore cannot preclaim the identity of a later parser
  element. The parent keeps registered DOM references in a parent-realm `WeakSet`;
  public attributes and author-realm expandos are never edit authority. Changing
  either public source identity revokes the
  registered object's authority and fails closed. Every source mutation
  revalidates the live object, its registered stable ID and its current
  SourceIndex mapping instead of trusting cached selection state. Runtime-generated descendants resolve only to their
  nearest still-proven authored source host.
- Stable ID and Runtime edit authority are separate contracts.
  `data-pageroot-id` is the durable identity of a source element, but an equal
  ID on a Runtime object never grants text, style or structure edit permission.
  Runtime authority additionally requires membership in the current
  generation's private registered object set and live SourceIndex validation.
- Each Runtime generation establishes its complete source DOM authority exactly
  once, before the first author Script activates. That authority set is sealed
  for the generation: author code cannot add a trusted source object after it
  starts. A registered object may lose authority when it disconnects or its
  identity no longer validates, but no generated, copied or forged object may
  gain authority later; such objects remain display/comment-only.
- PageRoot itself may grant this generation's edit authority to the exact
  nodes it created from one accepted semantic source transaction. The grant
  uses the existing parent-owned `RuntimeSourceElements` owner and requires
  the current receipt, frame, kernel or history identities, exact Node
  objects and local structure. It is not a reopened initialization registry
  and not a whole-document re-scan. Author-created same-ID objects, stale
  frames, old Documents and duplicate grants fail closed. See ADR 0074.
- PageRoot directly edits only nodes still proven to be authored source
  elements. A runtime-generated node is display-only: it may be commented on
  through its nearest source host but cannot be text-edited, styled, reordered,
  moved, duplicated or deleted as source. Element duplication additionally
  proves the complete selected live subtree against the current SourceIndex;
  generated descendants, opaque runtime surfaces and authored programs make
  that whole selection unsupported. The toolbar hides a known-unsupported copy
  action, uses disabled only for a transient Candidate/connection interval, and
  the command boundary repeats the same proof so alternate callers cannot
  bypass it. Ordinary text copy and complete-HTML save/export are unaffected.
- Every accepted semantic source change still produces complete next HTML.
  Structural operations carry a verified local projection plan when they can
  keep the current iframe; missing proof still rebuilds the disposable iframe
  and reruns the author program. Successful direct text, common-style,
  same-parent reorder and proven structural projections update the proved
  current DOM projection and end there;
  finishing the edit, changing selection, waiting or saving does not create a
  deferred author program rerun. Local projection failure, stale source identity
  and explicit recovery remain rebuild boundaries. A necessary pending recovery advances to
  the latest accepted source revision and clears only after that exact revision
  is successfully connected and promoted; an unrelated ordinary edit cannot
  erase it. Comments, save and source echoes without an HTML change do not
  require a rebuild.
- One scoped resource session may serve repeated disposable frames only while
  the authored script markup and bodies have the same exact program identity.
  A script change requires a new Canvas generation and a newly authorized
  resource closure.
- Inactive tabs retain no Edit page, Runtime DOM or static tab display; only the
  selected document owns the single active Canvas. Switching away discards the
  page and revokes its resource session; returning prepares a fresh closure and
  runs a fresh disposable page.
  Runtime preparing does not unmount the active `HtmlCanvasEditor` or replace
  it with an outer static Surface. Replacing authoritative HTML (adopted
  Version, disk reload, history, first open) writes Active as a static
  document first so Canvas verify can acknowledge the new bytes without waiting
  for author Script. Refreshing dynamic content then starts those scripts only
  in a hidden Candidate. Active has no second path that executes Script
  directly. A same-document
  authoritative replacement keeps a minimal viewport anchor and must not
  restore Caret, Range or a native editing session. Canvas verify and edit
  unlock must complete from that static Active frame even while Runtime
  prepare is still held. Comment-rail alignment of the shared stage must not
  replace the last reading position used for that restore.
- Runtime DOM, Canvas pixels, form state and generated nodes are never
  serialized to source, save, Version, export, Request, Candidate or Review.
  Source HTML plus stable IDs remains the only persistence authority.
- The former visual-signal gate, host discovery, real-paint/quiet-frame probe,
  runtime mutation audit, activity freeze, script prewarm, Runtime/DOM cache and
  per-node runtime snapshot reconciliation are retired.

## Editing-canvas experience and persistence contract

The product consistency promise is deliberately source-scoped: **an edit the
user completes against authored source content is saved in complete HTML and
is obtained again after close and reopen; transient runtime state is not a
saved fact.**

- Direct text and common-style edits must be visible in the current Canvas
  without a manual refresh. Safe high-frequency input updates the current
  authored DOM projection and must not replace the iframe for every keystroke.
  Once that synchronization succeeds it must not replace the iframe during
  input or after the ordinary edit boundary.
- The activation and critical-surface phase limits terminate only unfinished
  waits. A current result that has already settled and passed the necessary
  identity/readiness checks is not rejected after the fact for exceeding a
  performance target. Cancelled, terminated, superseded and lease-expired
  results remain permanently ineligible.
- The implementation preserves the current page whenever it can still prove a
  local source-backed update. A structure change without a verified projection
  plan, or a change whose result requires author Script, may rebuild the
  disposable iframe, but rebuilds are reserved for those explicit boundaries
  and for failed/stale local projection, rather than being a default follow-up
  to an already successful text/style or proven structural edit.
- A necessary rebuild should restore the shared scroll position, any exposed
  zoom context, and the selection resolved by stable element ID when those
  facts still have a valid target. Restoration is best-effort presentation;
  failure never permits runtime DOM to become source authority. The rebuild may
  show a brief loading interval and never interrupts active input; legal
  structure changes do not promise pixel-identical position afterward.
- When a rebuild replaces a settled Runtime iframe, the editor keeps a
  presentation-only handoff: iframe and shared-workspace scroll, a stable-ID
  visual anchor and screen offset, and zoom. It must not restore Caret, Range,
  Focus or a native editing session, and it must not migrate the last comment
  layout as proof that the new revision has already been measured. The old
  iframe remains the visible, interactive authority while the candidate is
  prepared and restores its own iframe reading position. One commit then
  switches Active identity and visibility together. Failure before that commit
  discards only the Candidate. The one-shot commit may still restore the
  previous Active identity and `data-render-verified` attribute if
  `connectFrame` fails after the slot switch; that short transactional rollback
  does not span the Candidate lifecycle and never rolls back Working HTML. The
  old iframe is retired on the next frame.
  This is a presentation handoff only, not Runtime DOM persistence or
  Script-state migration.
- Every completed operation materializes complete next HTML before ordinary
  autosave/Hash/CAS persistence. Reopen reads that HTML and reruns Script to
  produce ECharts, Canvas and other runtime output afresh.
- The minimum-complexity implementation that satisfies these guarantees wins.
  A sufficiently fast rebuild is acceptable; absence of every perceptible
  refresh is not itself a reason to add another runtime state system.

The following are explicit non-goals and must not be reintroduced as Canvas UX
optimizations: Runtime DOM persistence; timer/rAF/Observer/listener freeze;
persistent or per-node Runtime snapshot restore; Canvas/SVG pixel-state save; runtime/source per-node
reconciliation; Script execution-state migration; a dual-iframe synchronization
system; or equality of random values, current time, animation frames and other
runtime-only state after reopen.

## Boundaries

- The runtime remains a trusted-local authoring capability, not hostile-content
  isolation. The iframe has no Node integration or preload of its own, while
  same-origin parent reachability remains the accepted cost of DOM editing.
- Navigation, popup and form submission remain blocked. Author calls such as
  `location.assign()` and `location.replace()` are rejected at the direct-child
  frame navigation boundary, not by patching or freezing author APIs. Resource byte/count,
  source-root containment, CSP, stale generation/Hash and orphan-session limits
  remain fail-closed.
- Unsupported or failed programs fall back to the script-disabled source
  document and publish a visible static-degraded state; an ordinary iframe
  `load` may not be reported as successful Script execution. Edit does not use
  screenshots, bitmap projection or hidden execution probes.
- Edit Runtime does not promise exact parser-time Script scheduling. Establishing
  source authority may complete parsing and registration before activating
  parser-blocking, `async`, `defer` or module programs. Restoring every edge-case
  interleaving cannot justify Runtime snapshots, activity freeze, per-node
  provenance reconciliation or Script execution-state migration.
- The supported compatibility surface includes parser-blocking classic scripts,
  inline classic scripts, `defer`, import-free modules, author
  `DOMContentLoaded` listeners, and a first contained relative `<base href>`.
  Only Script elements in the live parsed document participate; apparent tags
  inside comments, raw-text elements and inert `template.content` do not.
  The bounded maintained parser distinguishes actual static/dynamic imports from comments,
  strings, regular expressions, property/private names and module metadata;
  `import.meta` is checked as supported metadata rather than treated as a module
  dependency. Parsing is used only for this dependency classification and does
  not provide a new module-loader implementation.
  Program identity and Main resource preparation must derive that base from the
  same first live-document `base[href]`: an earlier base without `href` does not
  win, inert `<template>` contents and foreign-namespace lookalikes do not
  participate, and absolute or escaping bases fail closed.
  PageRoot may defer the native `DOMContentLoaded` delivery until the supported
  non-async activation sequence has completed. An external or source-root-
  escaping base and module import graphs enter the explicit static-degraded
  state instead of running partially.
- Review continues to compare frozen source HTML only; runtime output is not a
  formal change fact.

## Required proof

- Ordinary DOM scripts continue running in Edit without leaking generated DOM
  into the Working Copy.
- ECharts and Canvas pages render in the real editable iframe.
- Parser-blocking classic, inline, `defer`, import-free module,
  `DOMContentLoaded` listener and contained relative `<base>` fixtures execute
  in real Electron; exact parser-time interleaving remains a non-goal.
- An unsupported module graph visibly reports static degradation and never
  presents a static iframe load as successful Script execution.
- Repeated preparations beyond the replay-window size remain available without
  restarting PageRoot, while current/recent request identities still reject replay.
- `location.assign()` and `location.replace()` cannot navigate the Edit frame.
- A semantic structure edit that cannot prove a local projection rebuilds the
  iframe, reruns the program and saves only the complete semantic HTML result.
  A proven ordinary-source insert, duplicate, delete or supported move keeps
  the current Document identity, grants only editor-created nodes from that
  transaction, and still saves complete HTML.
- Continuous direct text input and common formatting stay in the same document
  through edit completion, target changes, waiting and ordinary save; author
  Script is not rerun for those successful local projections. The completed
  common edit survives close and reopen from HTML.
- Same-parent reorder has the same in-place end state. Failed local synchronization
  and stale source mapping still rebuild.
- A settled, identity-current Candidate that has passed the required checks may
  promote even when its reported elapsed time exceeds the performance target.
  The phase limits still terminate unfinished waiting; cancelled, terminated,
  superseded or lease-expired results never regain authority.
- A required rebuild preserves shared scroll and stable-ID selection when the
  target remains valid, without serializing runtime output.
- Switching away and back creates a fresh runtime page without replaying an old
  request identity or reusing an inactive live Script DOM.
- Generated descendants map to a source host for comments and expose no source
  edit or structure commands. Copy is also absent for any selected parent whose
  subtree contains them, while a separate proved source subtree remains copyable.
- Reports containing many supported charts retain their Runtime display and
  comment path while ordinary source-backed regions remain directly editable.
  Editing prose does not promise to recalculate every chart. Complex apps may
  limit direct editing by region without disabling the whole page's Script.

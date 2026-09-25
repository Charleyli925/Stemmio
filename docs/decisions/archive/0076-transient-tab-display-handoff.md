# ADR 0076: Tab display pages existed only during an explicit handoff

- Status: Superseded by [ADR 0077](../0077-current-draft-live-canvas-handoff.md) for presentation; data and reading-state limits retained
- Date: 2026-09-16
- Scope: document-tab display projections, restart restoration and tab-switch presentation
- Supersedes: the tab Hot/Warm iframe pool in ADR 0045 and ADR 0048, and the restart/inactive-tab prewarm clauses in ADR 0051; Review analysis and the verified immutable script-byte store are unchanged

## Context

The former tab cache combined three different responsibilities: bounded HTML
bytes, per-tab reading state, and a pool of mounted script-disabled pages. It
also repopulated the active page before startup activation, waited for display
readiness plus two frames, and then read inactive Registry tabs in the
background.

Those presentation optimizations had become work in front of the document the
user actually asked to edit. Mounted iframe count and the source-string byte
budget also described different resource costs: the byte budget did not bound
parsed DOM, Preview resource sessions, images, fonts, Canvas or GPU state.

## Decision

- Startup restoration begins the normal registered-project activation as soon
  as Registry reconciliation identifies the pending tab. It does not first
  read a display projection, wait for a cache-ready acknowledgement or wait
  extra animation frames.
- Inactive tabs are not read in the background. There is no idle prewarm queue,
  retry timer, generation or late projection writeback.
- `DocumentSurfaceCacheSession` may retain at most 20 exact, fully persisted,
  Canvas-verified HTML projections within 32 MiB. These entries are data only;
  they do not keep an iframe, Document or Preview resource session alive and
  never mount a temporary tab display.
- Current-draft presentation is owned by ADR 0077's outgoing/incoming Canvas
  handoff. The old static display handoff, its readiness callbacks and its
  diagnostic opt-in are retired.
- Per-tab `scrollTop`, Canvas mode and bounded `PageViewContext` are stored
  separately from HTML bytes. Closing a tab removes both. HTML eviction keeps
  the light state, but restoration requires the same tab, Project, Document
  and source SHA; a new source revision starts with safe defaults rather than
  restoring stale source-target context.

## Authority constraints

- Cached HTML and presentation state remain process-memory projections. They
  never authorize source, save, export, Version, comment targets or editing.
- Dirty, pending, failed, flushing, Canvas-unverified or SHA-mismatched HTML is
  not admitted.
- Every activation still crosses `WorkbenchNavigationWorkflow` and
  `ProjectWorkflow`; cache absence or presentation failure must not delay or
  reject the authoritative open.
- `HtmlCanvasEditor` keeps its separate, bounded internal A/B Runtime handoff.
  Review request coalescing/cancellation and exact-version script bytes are not
  changed by this decision.

## Required proof

- Restart restoration emits no tab-projection prewarm and reaches an exact
  Canvas through the ordinary activation path.
- Settled active and inactive tabs own zero display-cache iframes, and a tab
  switch never mounts a static display cover.
- Source projections remain within the entry and byte limits, and eviction
  never closes a tab.
- Reading state survives HTML eviction for the exact source revision and is
  reset when that revision changes.
- Save, IME, undo/redo, external-change, comment and source identity guards
  remain owned by their existing workflows and tests.

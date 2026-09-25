# ADR 0077: Current draft switches keep the outgoing canvas until the incoming canvas is verified

- Status: Accepted
- Date: 2026-09-24
- Scope: current-draft tab presentation and Preview availability
- Supersedes: ADR 0076's normal tab-switch display-cover presentation; its bounded HTML data and reading-state policies remain

The static display-cover implementation from ADR 0076 is fully retired. The
retained `DocumentSurfaceCacheSession` stores only bounded HTML data and
per-tab mode, PageViewContext and scroll state; it never mounts a tab display
iframe and has no E2E opt-in handoff path.

## Decision

An ordinary current-draft switch still uses the existing navigation and
ProjectWorkflow safety fence. After the target document is published, Workbench
briefly retains the outgoing `HtmlCanvasEditor` as an inert, read-only visual
surface. Its edit, save, export, comment and runtime callbacks are detached.
The incoming document mounts its one final editor hidden in the same canvas
area. When `DocumentSession` verifies that editor's current generation and
exact rendered source SHA, Workbench removes the outgoing editor and reveals
the incoming one in the same commit. A failed incoming load removes the old
surface and shows an error with a retry action. A failed navigation before
publication keeps the original selected tab and shows a persistent retryable
error. No screenshot, capture IPC, image overlay, fixed presentation delay,
browser freeze or long-lived second editor is used.

Preview availability depends on the selected document identity and its
authoritative HTML content, subject to formal Review. Comment, Version,
Runtime and other background progress do not disable Preview. Entering
Preview does not wait for the incoming Edit Canvas verification; the outgoing
Edit Canvas is released on that mode change.

## Authority and resource limits

- The outgoing canvas never owns the new document's source receipt or save
  target. Navigation's existing source fence remains required before it can
  be retired or the new document can be published.
- At most two editors coexist during this short presentation interval: one
  inert outgoing canvas and one final incoming canvas. Settled state has one.
  Inactive tabs retain no editor or iframe.
- Exact Canvas authority is the reveal condition. A timeout, cache hit,
  screenshot or Preview-button readiness is not a substitute.
- Returning to the previously verified tab during an unfinished switch is a
  new activation. Its newly mounted Canvas remains hidden until that activation
  verifies, even if its tab ID and source SHA match the retained surface.

## Required proof

- In Electron, delay incoming Canvas readiness and verify that the outgoing
  canvas remains visually unchanged and inert, while the incoming one is
  hidden; then release readiness and verify one editor remains.
- Verify Preview opens the selected document during unrelated Canvas work.
- Verify a failed switch preserves the old selected tab, presents a persistent
  error and succeeds through the retry entry.
- Verify A→B→A before B verifies keeps the earlier A inert and visible until
  the returned A Canvas verifies its new generation.

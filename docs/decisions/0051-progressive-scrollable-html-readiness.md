# ADR 0051: HTML readiness is progressive and scroll never waits for Canvas verification

- Status: Accepted
- Date: 2026-08-28
- Scope: HTML open, tab activation, restart restoration and Canvas readiness

## Context

The first cache milestone measured pixels, not usability. A cached projection
could appear in roughly tens of milliseconds while a full Canvas generation and
author runtime still required more than a second. The cache iframe rejected all
pointer input, so the user saw content but could not scroll it. Restart restored
only tab identities and activated the current tab without prewarming the others.

## Decision

Readiness is split into independently observable stages:

1. `ContentScrollable`: safe HTML is visible and accepts native scrolling.
2. `SourceCurrent`: Registry, OpenTarget, path and source Hash are current.
3. `EditCapable`: the sole editable Canvas owns the exact source generation.
4. `VisualComplete`: optional author Canvas, SVG and ECharts output has settled.
5. `SupplementalReady`: versions, AI records, rules and other non-first-view facts are ready.

The retained tab cache stores exact HTML bytes and separate per-tab mode,
PageViewContext and scroll state. It never mounts a display Document or iframe;
the current-draft presentation path is the outgoing/incoming Canvas handoff in
ADR 0077.

A clean validation lease may skip the leave-side full Canvas drain only when
all switch obligations are resolved, no native input or history action exists,
the document is fully persisted, and Canvas authority has verified the exact
source SHA. Any mismatch uses the original full switch path.

Restart persistence remains identity-only. Once Registry identities are
reconciled, the active tab enters the normal verified Canvas activation path.
Inactive tabs are not read or prewarmed in the background. The bounded cache
captures only already-persisted, Canvas-verified source data and per-tab reading
state; it never owns Session, operation IDs, commit, rollback, save or Version
authority.

## Required proof

- the incoming Canvas remains hidden and the outgoing Canvas remains inert until
  exact generation and source verification complete;
- active restart reaches the verified Canvas through ordinary activation;
- inactive restored tabs retain only bounded data and reading state without
  activating their projects;
- dirty, pending, conflicted or SHA-mismatched documents use the full switch path;
- Canvas first-scroll response and chart/full-content readiness are reported
  separately in the real benchmark;
- source, edit, save, Review and Version authority remain unchanged.

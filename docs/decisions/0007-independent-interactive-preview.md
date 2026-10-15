# ADR 0007: Interactive preview uses an independent document and source-backed edit context

- Status: Accepted; preview-to-edit visual handoff superseded by ADR 0013
- Date: 2026-07-29

## Context

Desktop preview previously used `srcdoc`. The frame inherited the application
renderer's `script-src 'self'` Content Security Policy, so authored inline and
external chart scripts did not run even when the iframe sandbox allowed
scripts. Relaxing the host CSP or enabling scripts in the editing iframe would
expand application authority and conflict with the source-faithful editable
island model.

A full runtime DOM snapshot is also not a safe editing projection. Script-added
text, moved nodes and arbitrary child structure have no stable source identity.
Copying them into `HtmlCanvasEditor` would trip its source/DOM consistency
checks, invite runtime data into SourcePatch, and destabilize Selection and IME.
At the same time, reports commonly leave authored chart containers and table
bodies empty for a bounded script to fill. Hiding those visuals in Edit makes
the surrounding source-authored analysis hard to review.

## Decision

The independent preview/session decision below remains active. The two-case
Canvas/table visual handoff is retained here as historical context and is
superseded by `0017-shared-runtime-snapshot-owner.md`.

- Electron registers one standard, secure `stemmio-preview:` scheme before the
  app is ready. The scheme does not bypass CSP.
- The main process owns bounded, short-lived preview sessions. A trusted
  application main frame may create, inspect liveness of, or revoke a session
  through narrow IPC methods. Inspection neither refreshes the expiry nor
  returns a resource manifest. Preview subframes receive no Stemmio preload API.
- A session serves prepared HTML, one fixed bootstrap script and a bounded
  manifest of declared relative script, style, image, font and media assets.
  The manifest follows safe CSS and module dependencies, but rejects dotfiles,
  undeclared siblings and symlink escapes; the source directory is never an
  arbitrary filesystem reader. The document CSP also rejects authored `file:`
  bases and resource loads.
- The application renderer CSP remains `script-src 'self'`; only `frame-src`
  admits the preview scheme.
- Returning from preview captures a bounded `PageViewContext`. It may carry
  source-backed active/inactive class transitions plus `hidden`, `open`,
  `aria-selected` and `aria-expanded`.
- The same context may also carry a small read-only visual projection for a
  uniquely source-backed placeholder that is still empty in source:
  a bounded PNG snapshot of a visible Canvas, or sanitized table rows for an
  authored empty `tbody`. The visual payload has strict count, byte and
  dimension limits. Table markup is allowlisted and scripts, event handlers,
  images and unsafe styles are removed.
- Stale Hashes, duplicated/unknown nodes, non-empty source targets, truncated
  captures, arbitrary runtime classes and all other text/HTML/style/form/
  scroll/runtime-child state are rejected.
- `HtmlCanvasEditor` remains mounted, script-disabled and source-authored. It
  applies the accepted state and visual payload as disposable, non-editable
  presentation nodes, then continues to use the existing editable-island and
  SourcePatch path. These nodes are removed before context replacement and are
  never serialized or passed to SourcePatch.

## Consequences

Desktop preview behaves like the authored page without weakening PageRoot's
renderer CSP. Clicking Edit preserves the selected source-backed Tab with no
new mode or user step, and existing text editing, Selection and IME keep their
current source/DOM assumptions. Script-rendered charts and empty authored table
bodies remain visible for review in Edit, but are deliberately not selectable
or editable.

The current draft may keep its exact verified Preview iframe hidden for a
three-second same-document return after Edit settles. Workbench checks the
corresponding Main resource session before revealing it again and otherwise
loads a new iframe. The old Preview never becomes an editing or saving source.

Arbitrary runtime DOM, rewritten prose, SVG trees, form values and scroll state
remain preview-only. Extending the projection beyond the two bounded,
source-empty visual cases requires a new decision and source-fidelity proof.

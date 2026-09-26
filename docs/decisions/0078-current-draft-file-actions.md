# ADR 0078: Current draft file actions

Status: Accepted.

## Context

Two refresh commands exposed an implementation distinction users could not infer. A checkbox beside export hid when it applied, while “save as a new version” suggested opening another editable document. The preserved-draft menu also competed with ordinary immutable history.

## Decision

The current interaction and wording owner is [the version PRD](../VERSION_AND_PROJECT_FILES_PRD.md#9-html-导出). “保存到历史版本” stores the current moment and continues the same current draft. Export first shows a dialog with history saving checked by default; confirmation opens the native save picker. This replaces only ADR 0073's menu checkbox and default-off decision. Export still succeeds before history creation consumes the exact exported bytes; cancellation, failure and unchanged content never allocate a duplicate version.

The regular menu contains one “刷新”, reading the saved current draft through the existing reload owner and preserving Edit/Preview mode. Pending Review and history cannot use it to replace source. There is no separate regular iframe-redraw button.

Remove the regular “找回此前的稿件” entry and its chooser. Existing preserved records, displaced-draft protection, transaction recovery and backend validation remain; removing the entry never deletes data. Old tests and ADR prose are not authority to restore it.

## Alternatives and consequences

Keeping two refresh labels and an adjacent export checkbox was rejected because it required users to understand runtime and storage distinctions. Keeping history saving off would avoid an extra snapshot but make export a less useful preservation point; no-change detection bounds duplicate history. The confirmation adds one step but places the choice immediately before export and explains that editing continues in the same draft.

The menu no longer offers manual browsing of preserved drafts. Reintroducing that workflow requires a new explicit product decision and an identified use case; it is not implied by retaining recovery data. The single-current identity, immutable history, protected destinations and unknown-outcome reconciliation of ADR 0073 remain binding.

Ordinary export shortcuts share the menu dialog; recovery exits still allow direct export. Cancelling returns focus to the entry control, and dialog interaction preserves the native edit selection.

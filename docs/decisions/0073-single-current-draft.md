# ADR 0073: One editable current draft and immutable history

Status: Accepted.

## Decision

A Project has one editable Working Copy. Its stable workingCopyId and visible
path survive local version creation, AI adoption and explicit creation from
history. Every Version is an immutable milestone, including the newest one.
The sidebar puts project rules and current draft before collapsed ordinal history.

Autosave and session Undo/Redo do not create Versions. Explicit local save
creates the next ordinal from persisted current HTML without consuming comments
or attachments. Unchanged content, including initial Stable ID materialization
alone, creates no duplicate Version. AI adoption retains frozen Request and
Candidate authority. History/recovery creation creates the next ordinal and
replaces the same current draft after preserving the displaced HTML, comments
and attachment bytes. Established snapshots are never rewritten.

## Ownership and transactions

ProjectFileRepository is the only persistent writer; manifest publication is
the commit point. Mutations share the Registry/project lock and validate
project, document, Working Copy identity and expected source hash. Operation IDs
make retries and crash recovery idempotent. A lost reply is queried before a new
operation. Active Requests and unresolved Candidates cannot be silently
displaced by manual version or recovery operations.

VersionWorkflow owns command, export and reconciliation phases. DocumentSession
owns current HTML and persistence evidence. ProjectWorkflow publishes the
verified OpenTarget even when its path and Working Copy ID remain unchanged.
VersionSession owns immutable history projection. Views render facts and
dispatch intent; no parallel current-document store is introduced.

## Format boundary

The v4 manifest marks `currentDraftSchemaVersion: "1.0.0"` and contains
exactly one editable Working Copy. The Repository validates that marker and
membership on every load; missing or older markers, multiple members and
retired Working Copy metadata fail closed without a rewrite. There is no
forward migration or recovery menu for an old multi-working-copy project.
Pre-v4 projects and unknown Registry shapes remain unsupported. ADR 0022's
Registry/path authorization remains binding.

## Export and Finder

Plain export copies exact current HTML, or the viewed snapshot, to the chosen
external destination. The native dialog first starts in Downloads, then the
last successful external directory. Main owns that preference and verifies
receipts. Project roots, hidden managed data and aliases remain protected;
unsafe explicit destinations are rejected, never silently substituted.

The option to also save a Version is off each time the menu opens. Export
succeeds before the same local-version command runs against the exported hash.
Cancellation/failure creates no Version. If version creation is uncertain after
export, retry reconciles that operation without exporting again. Plain HTML
contains no comment, rules or attachment package.

The catalog hides inactive projects only after a successful root scan proves
absence; Registry identity remains available for supported return. Unreadable
roots, permission failures, corrupt records and duplicate identities are
availability failures, not deletion. An absent active source stops old-path
writes, preserves recoverable current content and remains exportable without
recreating the removed directory.

Archive/search/clone UI, resource bundles, complete backup/restore and review
exchange packages remain outside this change.

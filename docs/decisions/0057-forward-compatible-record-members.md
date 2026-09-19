# ADR 0057: Mutable records preserve unknown members instead of dropping or refusing them

> Renumbered from ADR 0032 on 2026-08-29 to repair a numbering collision.

- Status: Accepted
- Date: 2026-08-21
- Extends: ADR 0022, ADR 0028

## Context

Every mutable PageRoot record is persisted as JSON, read back, edited, and
written again by the same code path. Adding a member to any of those records is
a normal part of product evolution, but the repository had three different and
undocumented answers to the question "what does this build do with a member it
has never seen?".

- `manifest.json` and `project.json` validate their required members and return
  the object they read. An unknown member survives.
- `runtime-state.json` preserves the current root record while authored
  request/task anchors are rebuilt from current authority. Unsupported
  historical activation receipts are rejected.
- The Registry rejected any record carrying a key outside a hard-coded allowlist.
  A single added member turned the whole Registry into
  `UNSUPPORTED_REGISTRY_SCHEMA`, which locks the user out of **every** managed
  project, not just the one that changed. Historical Runtime
  `historyActivation` receipts are no longer part of the current record and
  fail closed.
- The now-retired persistent source-history record once did the opposite and
  the most damaging thing. Its fixed-field decoder rebuilt each object, so an
  unknown member was **silently discarded**, and the next atomic write
  persisted the truncated record. The user lost data with no error anywhere.
- `activeDraftSnapshot` rebuilt the Draft top level the same way, discarding
  unknown top-level members while passing comment and event objects through.

ADR 0028 established the governing principle for the Registry: "Refusing to read
is recoverable; overwriting is not." That principle was written against a
Registry whose *required* members were missing, where reading a shape we cannot
explain and then rewriting it destroys real bindings. It was never an argument
for deleting a member from a record we fully understand. Silent field-level
truncation is the overwriting case ADR 0028 rejects, applied one member at a
time.

The three behaviors also disagree with each other, so the answer to "can we add
a member" depended on which file was involved and could only be found by reading
the implementation.

## Decision

One rule applies to every mutable record.

1. **Required members stay strictly validated.** A record whose required members
   are missing, malformed or mutually inconsistent is still an unrecognized shape
   and still fails closed with its existing error code. ADR 0028 is unchanged for
   the case it actually decided.
2. **A record that satisfies every required member is explainable.** It is read
   normally even when it carries additional members this build does not know.
3. **Unknown members are preserved unchanged across read, edit and write.** An
   older build never silently deletes a newer build's data.
4. **Preserved members take no part in validation, routing or adoption.** They are
   inert payload, and they remain inside the existing size budgets — the source
   history journal byte limit already counts them.
5. Schemas for records covered by this rule drop `additionalProperties: false`
   and carry a `$comment` stating the rule. Schemas for immutable records and for
   compatibility decoders keep their strict form, because those records are
   written once and never round-tripped.
6. A sub-record is **preserved** or **authored**, and only a preserved one may
   carry unknown members. Authored sub-records are rebuilt from an authoritative
   source on every write and keep `additionalProperties: false`:
   `workingCopies[].fileIdentity` (a fresh stat — a save publishes through an
   atomic rename, so the inode legitimately changes), the Runtime
   `activeRequest` (replaced on every status transition), the Runtime
   `lastAiTask` anchor, the Registry write-lock owner file, and the stored Draft
   envelope. The rule is applied per level, not per file.
7. A preserved record must be written as `{ ...read, ...authoritative }`. The
   reverse order lets a stale file overwrite the identity the writer just
   computed and pin the schema version forever.

## Scope

Covered and pinned by tests: the Registry, the source history journal, the Draft
aggregate, `manifest.json` (manifest, Version entries, Working Copy entries),
`working-copy-state.json`, and the current root of `runtime-state.json`.

Deliberately excluded: `project.json` is written once at import and never
rewritten, so it is an immutable record. The authored sub-records listed in item
6 stay strict for the reason given there.

## Consequences

- Registry, source history journal and Draft now behave the way `manifest.json`
  and `runtime-state.json` already did, and `manifest.json` plus
  `working-copy-state.json` are now pinned by tests instead of only observed.
- Applying the rule surfaced a real defect that the rule itself created. The
  repository stores a Draft as `{ schemaVersion, projectId, documentId,
  workingCopyId, basedOnVersionId, ...snapshot }`, so once the snapshot preserved
  unknown members it also carried those five envelope members back from disk and
  spread them over the authoritative values. A tampered file could then pin
  `schemaVersion` and reassign the Working Copy. Item 6 and item 7 exist because
  of that defect, and `tests/project-working-copy-save.test.mjs` reproduces it.
- A future member can be added to a mutable record without a schema-version bump
  and without a migration pass, which is what makes account identity, record
  provenance and portable/device data separation additive rather than breaking
  changes.
- `tests/source-history.test.mjs`, `tests/draft-service.test.mjs` and
  `tests/project-working-copy-save.test.mjs` each prove the round trip and each
  fails without the corresponding production change. `source-history` also proves
  that an unknown member never rescues an invalid required member.
- **This protects builds from this change onward only.** A build released before
  it still refuses or discards a newer member, and nothing shipped can change
  that. Any release that adds a member to a mutable record must therefore come
  strictly after the release that carries this ADR, so that the intermediate
  build exists in the field first.

## Rejected alternatives

- **Keep dropping unknown members.** Rejected: it is silent, unrecoverable data
  loss, and it is the exact failure mode ADR 0028 was written to prevent.
- **Keep the Registry allowlist and fail closed on any added member.** Rejected:
  a single added member locks the user out of every managed project. Refusing to
  read is recoverable only when the record is genuinely unexplainable; here it is
  fully explainable.
- **Route every future member through one reserved `extensions` object.** This
  keeps a strict allowlist at the top level and still allows growth. Rejected
  because an already released build does not have `extensions` in its allowlist
  either, so it buys no compatibility with the field population that matters,
  while permanently pushing real members into a second-class namespace.
- **Bump the schema version for each added member.** Rejected: the older build
  then fails closed on the new version, which is the lockout outcome above with
  extra migration cost.

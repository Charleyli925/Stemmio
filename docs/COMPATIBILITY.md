# Current-format compatibility policy

Stemmio supports the records, interfaces and release artifacts produced by the
current formal workflow. Three narrowly bounded ingress adapters cover bytes
written by shipped Developer Preview builds; neither adapter restores a retired
product model. There is no migration pass, general compatibility window,
old-data recovery entry point, or old-client distribution path.

## Storage and request boundaries

- A Request is created from a complete compiled Task Spec. Missing required
  fields fail with the existing invalid-format path; `instructions`, `summary`
  and `preserveOutsideTargets` are never interpreted as a substitute.
- Agent delivery records use the current provider-neutral selection and complete
  identity fields. The retired Qoder delivery shape, driver aliases and
  `allowLegacy` switch are rejected.
- A project manifest contains one editable current Working Copy. Versions are
  immutable snapshots. Retired Working Copy lists, non-null historical
  activation receipts and old promotion journals are rejected without rewriting
  bytes. A shipped v4 Runtime that contains only the inert
  `historyActivation: null` tombstone is decoded at Registry ingress by dropping
  that member in memory; the reader does not replay, expose or recreate an
  activation receipt.
- Current save, Version creation, Request freeze and adoption transactions keep
  their complete crash recovery, idempotent retry and source-identity checks.
  Source-element identity materialization for a newly imported external HTML is
  current behavior, not historical-data recovery. An existing Working Copy
  without the current identity contract is rejected; only an explicit current
  force-unlock adoption may materialize identities, with its crash recovery
  journal intact.
- Candidate impact is stored and read only as bounded counts and samples.
  Records containing the retired full-array impact members are rejected.
- A shipped Candidate assessment that exactly matches its sealed HTML under the
  former script-neutral policy remains readable. When those bytes prove an
  authored `<script>` change, the reader projects the current
  `AUTHORED_SCRIPT_CHANGED` attention result in memory without rewriting the
  record; any unrelated status or issue-code drift remains invalid.
- Preferences use the current schema and validation rules. An unsupported or
  damaged file falls back to safe defaults without an upgrade write.
- The shipped schema-1 Stemmio credential ciphertext remains readable through
  the same macOS safe-storage boundary. It receives a deterministic current
  record identity in memory and is rewritten as schema 2 only after an explicit
  save or clear; malformed, plaintext or unsupported provider records remain
  unreadable.
- Public distribution assets contain the signed updater metadata, installers,
  differential update files, checksums and provenance. The schema-1
  `update-manifest.json` artifact is neither generated nor required.

## Current mutable-record rule

Mutable current records preserve unknown members at the level where they are
round-tripped, while authored sub-records are rebuilt from authoritative state.
Required members remain strict: missing, malformed or mixed-format records fail
closed. This rule protects current records from forward additions; it is not a
reader for retired product models.

## Rejection evidence

The focused tests retain only small negative examples for retired shapes:

- `tests/project-file-schema.test.mjs` rejects missing current-draft markers,
  retired Working Copy members and persisted runtime history activation.
- `tests/project-registry-and-open.test.mjs` verifies non-null activation
  receipts remain rejected and the shipped null tombstone is ignored without
  rewriting source bytes.
- `tests/agent-session-credential-store.test.mjs` verifies the shipped
  ciphertext-only credential remains readable and canonicalizes only on an
  explicit mutation.
- `tests/compatibility-decoders.test.mjs` verifies the shipped script-neutral
  Candidate assessment is reclassified only from its sealed HTML evidence and
  that unrelated policy drift remains rejected.
- `tests/agent-delivery-codec.test.mjs` rejects the removed Qoder delivery
  record without conversion.
- `tests/run-lifecycle.test.mjs` and
  `tests/project-file-schema.test.mjs` reject retired Candidate impact arrays.
- `tests/conversation-v2.test.mjs` rejects unsupported conversation and draft
  schema versions without projecting them into current records.

These tests do not attempt to repair, replay or inventory old data beyond the
three explicit shipped-current ingress adapters above.
Current recovery scenarios are constructed by the current writers and remain
covered by the save, Version, Request and adoption recovery suites.

## Documentation rule

When a current writer changes a persisted shape, update its schema, reader,
negative evidence and owner documentation in the same change. Do not add a
compatibility directory, migration command, recovery UI or upgrade waiting
period for a retired format.

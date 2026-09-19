# Active schema allowlist

Only the files listed below are product contracts and package inputs.

## HTML source identity

- `stemmio-element-identity.v1.schema.json` defines the value written to the
  sole persistent Stemmio-owned HTML attribute, `data-stemmio-id`. The schema
  does not itself authorize writing that attribute.
- `source-element-identity-migration.v1.schema.json` is the strict recoverable
  transaction that authorizes a current registered Working Copy to materialize
  identity for newly imported external HTML. It seals before/after Hashes and
  recovery paths; it never covers historical Versions or Runtime DOM.
- `working-copy-state.v4.schema.json` requires
  `sourceElementIdentityBindingSha256` whenever identity schema v1 is present.
  The Hash seals ID/tag/identified-parent/source-order bindings without freezing
  editable text, attributes or styles. Runtime compatibility can read the brief
  pre-binding PR2 state only to route it to an explicit force-unlock conflict;
  newly authored schema-v4 records cannot omit the seal.

## Unknown members in mutable records

A mutable record is one this product reads, edits and writes again. For those
records every required member stays strictly validated, and a member added by a
newer Stemmio is preserved unchanged across the round trip. A record whose
required members are missing or invalid is still an unrecognized shape and still
fails closed. Dropping a member we do not recognize is silent data loss, and
refusing the whole file over one added member locks the user out of data this
build can otherwise read.

A sub-record is either **preserved** or **authored**, and only a preserved one
can carry unknown members:

- **Preserved** — round-tripped from disk. A writer either mutates the object it
  read, or spreads it first and overrides authoritative members after
  (`{ ...read, ...authoritative }`). Covered: `project-registry.v4`,
  `project-manifest.v4` (manifest, Version entries, Working
  Copy entries), `working-copy-state.v4`, `project-runtime-state.v4` (root
  only), and the Draft aggregate, which has no schema file. These
  drop `additionalProperties: false` and carry a `$comment`.
- **Authored** — rebuilt from an authoritative source on every write, so it
  cannot carry an unknown member and keeps `additionalProperties: false`. This is
  `workingCopies[].fileIdentity` (a fresh stat; a save publishes through an
  atomic rename, so the inode legitimately changes), the Runtime `activeRequest`
  (replaced on every status transition), the Runtime `lastAiTask` anchor
  (re-derived from the AI task record), the Registry write-lock owner file, and
  the stored Draft envelope (`schemaVersion`, `projectId`, `documentId`,
  `workingCopyId`, `basedOnVersionId`).

A record can be layered: `project-runtime-state.v4` is preserved at its root but
authored in `activeRequest` and `lastAiTask`, so the rule is applied per level
rather than per file.

The reverse spread order `{ ...authoritative, ...read }` is a defect: it lets a
stale file overwrite the identity the writer just computed and pin the schema
version forever. `tests/project-working-copy-save.test.mjs` pins that case.

`project-identity.v4` is written once at import and never rewritten, so it is an
immutable record and stays strict by the rule below.

## Portable records and device-scoped members

`project-manifest.v4` travels with the project directory, so every member must
still mean something on another machine. Exactly one member is device-scoped:
`workingCopies[].fileIdentity`. It stays in the manifest because the current
Version protocol compares it to detect a replaced Working Copy and a committed
record that no longer matches its sealed transaction; a device-local sidecar can be
absent, which would turn both fail-closed controls into checks that silently
pass. A future synchronisation layer recomputes it on the receiving device
instead of transporting it.

`tests/portable-project-record.test.mjs` enumerates the schema's members and
fails when one is neither classified portable nor classified device-scoped, so a
new member forces an explicit decision. See
[`docs/decisions/0034-portable-project-record-boundary.md`](../docs/decisions/0034-portable-project-record-boundary.md).

Immutable records — anything written once and never rewritten — and the
compatibility decoders keep their strict `additionalProperties: false` form. See
[`docs/decisions/0057-forward-compatible-record-members.md`](../docs/decisions/0057-forward-compatible-record-members.md).

## Strict v3 main records

- `annotation-records.v3.schema.json`
- `change-request.v3.schema.json`
- `project-state.v3.schema.json`
- `runtime-state.v3.schema.json`
- `version-manifest.v3.schema.json`

The runtime must reject v1/v2 forms of these records with
`UNSUPPORTED_SCHEMA_VERSION`. It does not migrate, infer, fill, or display old
records.

## Current auxiliary records

- `task-spec.v1.schema.json` is the strict, system-compiled task contract for
  current v4 AI Requests. It references the existing v3 Target and attachment
  definitions so source identity evidence stays unchanged. Raw comments and
  already-applied change events remain in frozen annotations rather than being
  copied into the executable requirements object.
- `candidate-assessment.v1.schema.json`
- `scope-report.v1.schema.json` (current direct-edit evidence)
- `completion.v1.schema.json`
- `input-manifest.v1.schema.json`
- `attempt-outcome.v1.schema.json`
- `current-version-transaction.v1.schema.json`
- `committed-marker.v1.schema.json`
- `conversation.v1.schema.json`
- `conversation.v2.schema.json`
- `conversation.v3.schema.json`
- `conversation-index.v1.schema.json`
- `conversation-draft.v1.schema.json`
- `conversation-draft.v2.schema.json`

## v4 project-file records

- `project-identity.v4.schema.json`
- `project-registry.v4.schema.json`
- `project-manifest.v4.schema.json`
- `project-runtime-state.v4.schema.json`
- `working-copy-state.v4.schema.json`
- `candidate.v4.schema.json`
- `source-element-identity-migration.v1.schema.json`

The Registry is the canonical write whitelist for v4. It records only direct
children of the configured project root, the registered root path, a root
filesystem identity used only for same-parent rename recovery, and durable
pending-import intent. A copied `.stemmio` directory is never registry
authority.

The v1 suffix here is local to each auxiliary artifact and remains its current
strict contract. These files are not compatibility readers for old main
records.

New `candidate.v4` writers persist `submittedOutputSha256` and an identity-v1
report inside the Candidate record. These members are required; a Candidate
without them is an unsupported format and cannot enter Review or adoption.

`candidate-assessment.v1.schema.json` requires document-health, continuity and
bounded impact evidence. Retired executable-surface members fail closed.
`bridge/candidate-assessment-decoder.mjs` verifies current records against
sealed HTML and all required Hashes.

Canvas undo is a renderer-only 20-step stack for the currently open HTML. The
former persistent-history schema and decoder are retired. Crash recovery may
keep exact operations only as pending-save evidence, never as a restored undo
cursor.

`conversation.v3.schema.json` is the current writer and reader contract for one
Stemmio AI conversation thread. The v1 and v2 schemas remain rejection fixtures
only and are not accepted by the current reader. A Conversation
belongs to exactly one Document and its contexts, turns and messages live in the
same record, so reading one Document's thread can never surface another's. Two
rules are load-bearing and pinned by
`tests/conversation-repository.test.mjs`:

- **A stored message is always terminal.** A streaming fragment stays in Bridge
  memory and is written once, when its Turn seals. `draft`, `queued` and
  `streaming` are refused on write, so crash recovery never has to repair a half
  record.
- **A stored message carries no interface member.** `actions`, `buttons`,
  `cardState`, `disabled`, `pending` and `controls` are refused. An executable
  action is derived from current product state by the action bar, never read
  from a stored fact, so scrolling back through history cannot surface a stale
  button.

`conversation-index.v1.schema.json` maps each Document to its Conversations and
to that Document's single current Conversation. It is a rebuildable projection
of the authoritative conversation records; it exists so the history list renders
without opening every conversation file.

`conversation-draft.v2.schema.json` is the current unsent Composer content for one
Conversation, kept in its own small record so a debounced draft write never
rewrites the message history. A draft never enters a Request, Prompt,
`USER_SUPPLEMENT` or Candidate.

The current v3 writer binds each Agent turn to a provider selection, nullable
runtime binding, and capability-snapshot fingerprint. Stored Agent messages use
the generic `agent` actor plus `providerId` and the actual provider-namespaced
model. Older conversation records and delivery fields are rejected.

Deprecated main v1/v2 schemas and `migration-report.v1.schema.json` are not
kept in the active source tree or release package. Their evidence exists only
in the read-only pre-cutover backup.

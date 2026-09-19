# Compatibility decoder fixtures

These fixtures are input evidence only. They are never copied into a project,
rewritten in place, or used as a new producer format.

- `draft-command.missing-operation-id.json` proves that a Draft command
  without `operationId` now fails closed.
- `draft-authority.current.json` is the current Draft aggregate, including a
  previously persisted `draftop_legacy_*` acknowledgement that remains
  readable.
- `version-edit-event.legacy-aliases.json` proves that `baseVersionId` /
  `capturedRevision` fail closed.
Candidate assessment fixtures stay beside their sealed HTML evidence in
`../candidate-assessment-compat/`. Current assessments remain readable;
retired executable-surface shapes fail closed.

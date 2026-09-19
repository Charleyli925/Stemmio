# ADR 0034: The project manifest stays portable by classification, and its one device-scoped member stays put

- Status: Accepted; physical identity authority superseded by [ADR 0070](0070-durable-working-copy-binding.md)
- Date: 2026-08-21
- Extends: ADR 0022, ADR 0057

## Context

`manifest.json` travels with the project directory. A user who copies or
synchronises that folder carries it verbatim to another machine, so a member
that only means something on the machine that wrote it is a latent defect: it is
either misleading there or actively wrong.

The planned work item was "separate device-local data out of the portable
project record", assuming the manifest mixed the two. Reading the schema shows
it does not. Every root, Version and Working Copy member is an identifier, a
hash, an ordinal, a timestamp or a project-relative path. Exactly one member is
device-scoped: `workingCopies[].fileIdentity`, holding `device`, `inode` and
`birthtimeMs`. The other device-bound record, the Registry, already lives
outside the project directory at the projects root and is not affected.

`fileIdentity` looked like a disposable cache that could move to a device-local
sidecar and be recomputed by `stat`. It is not. It is a fail-closed witness in
the current Version publication protocol:

- The current Version transaction compares the recorded identity against a fresh
  `stat` of the allocated Version Working Copy to detect that the file was
  replaced before manifest publication.
- The commit check compares the committed manifest facts, identity
  included, against the sealed transaction authority.
- Same-parent rename recovery uses it to find a Working Copy after the user
  renames its HTML.

Moving it to a sidecar changes those two controls in the worst way. A sidecar can
be absent — it is device-local, so a copied or restored project simply will not
have one — and an absent witness leaves only two options: fail the promotion,
which breaks an ordinary copy, or skip the comparison, which turns a fail-closed
control into one that silently passes exactly when the file provenance is least
certain.

Unlike record provenance in `ADR 0033`, nothing here is irrecoverable. Deferring
the move loses no information; the cost of moving later is a mechanical
migration, and the identity can always be recomputed from `stat` while the file
is in place.

## Decision

1. `workingCopies[].fileIdentity` stays in `manifest.json`. It is documented as
   the single device-scoped member of an otherwise portable record.
2. The portable/device boundary is pinned by classification rather than by
   moving bytes. `tests/portable-project-record.test.mjs` enumerates the schema's
   declared members and fails when one is neither classified portable nor
   classified device-scoped, so a new member forces an explicit decision instead
   of drifting in.
3. The same test asserts that a written manifest contains no absolute path from
   the machine that produced it, and that stripping exactly one member yields a
   fully portable record.
4. A future synchronisation layer must **recompute** `fileIdentity` on the
   receiving device, never transport it. Transporting it would assert a file
   identity that does not exist there.

## Consequences

- The promotion protocol keeps both fail-closed controls unchanged. No integrity
  check is weakened to buy portability that is not needed yet.
- "Which side of the boundary does this belong on" now has a mechanical answer
  for the next member added to the manifest, which is the durable part of the
  original concern.
- When synchronisation is built, the work is confined to the sync layer: strip
  one member on send, recompute it on receive. No schema change and no on-disk
  migration is required of existing installations.
- If the promotion protocol ever stops depending on `fileIdentity`, this decision
  should be revisited, because the argument for keeping it is the dependency and
  not the location.

## Rejected alternatives

- **Move `fileIdentity` to a device-local sidecar now.** Rejected: an absent
  sidecar forces either a broken copy or a silently skipped integrity check, and
  the benefit is portability that no shipped feature consumes.
- **Make `fileIdentity` optional in the manifest.** Rejected for the same reason
  in a weaker form: an optional witness is a witness the promotion protocol
  cannot rely on. It also removes a required member, which `ADR 0057` does not
  make safe for an older reader.
- **Leave the boundary undocumented.** Rejected: the original concern was real
  even though its premise was wrong. Without a classification the next
  device-local member enters the portable record unnoticed, and the argument has
  to be rediscovered from the promotion code.

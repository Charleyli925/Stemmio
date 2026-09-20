# Internal source governance

Stemmio uses a maintainer-led private-source model. `Charleyli925/Stemmio` is
the internal source repository; `Charleyli925/Stemmio-Releases` is the public
binary, support and security-reporting surface.

The repository owner is responsible for product direction, authorized source
access, security releases, merge decisions, release-signing policy and use of
the product branding. Significant protocol, persistence, security or
compatibility changes should be proposed before implementation and documented
as an architecture decision when accepted.

Routine internal changes are merged after review and required CI. The
maintainer may use squash merging to keep `main` linear and may close changes
that conflict with the source-fidelity or security model. Source tags are
created only by the governed release workflow; public release assets are
published only in `Stemmio-Releases` and are never silently replaced.

Public product feedback belongs in `Stemmio-Releases` Issues. This internal
governance document may change without a public source-governance process.

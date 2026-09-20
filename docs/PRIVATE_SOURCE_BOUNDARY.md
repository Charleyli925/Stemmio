# Private-source boundary

`Charleyli925/Stemmio` is Stemmio's private, canonical source repository. It
contains the complete application, tests, CI, internal architecture and release
tooling. Only authorized collaborators may access it. A clean authorized clone
followed by `npm ci` contains everything required to run the source gates.

## Public distribution boundary

`Charleyli925/Stemmio-Releases` is the public download and update channel. It
may contain only:

- signed installers, update ZIPs and blockmaps;
- `latest-mac.yml`, `SHA256SUMS.txt`, `build-info.json` and
  `release-candidate.json` for installer verification and provenance;
- user-facing Release notes, support and security-reporting information.

It must not contain application source, Git checkouts, source archives, source
maps, debug-symbol or crash artifacts, CI logs, Actions artifacts, internal
design material, credentials, private paths or real user data. The source
repository's Release workflow verifies a frozen
candidate there through a narrowly scoped distribution credential; it never
publishes formal release assets from the private source repository itself.

An Electron installer is a user-controlled client artifact, not a secrecy
boundary: its packaged JavaScript (including `app.asar`) can be inspected.
Never place API secrets, signing material, license-private keys, server-only
rules or privileged authorization decisions in the desktop bundle. The package
verifier rejects source maps in the renderer output, `app.asar` and Resources
so a debug build cannot silently widen what the public installer discloses.

## Excluded from every source and release path

- Real user HTML, attachments and project records
- Local backups, previous workspace copies and internal design-review notes
- Developer home-directory paths, credentials, signing certificates and notarization secrets
- The production PostHog Project token and generated
  `output/release-metadata/usage-telemetry-config.json`; packaging receives the
  public ingestion token from repository Actions secrets
- `node_modules/`, build caches, test output, `.app`, DMG and other generated release files
- Private operational logs and unpublished research material

Release artifacts are generated from an immutable, clean source commit and
carry `build-info.json` identifying that commit. Before every internal push,
review `git diff --cached`, run a secret scan appropriate to the change and
confirm that no user-controlled files were added.

## Historical public versions

Versions, commits and releases that were previously published under Apache
License 2.0 remain governed by the license supplied with those published
versions. This boundary and the current proprietary license govern future
private-source development; they do not purport to withdraw previously granted
rights.

The irreversible visibility switch is governed by
[`PRIVATE_SOURCE_CUTOVER.md`](PRIVATE_SOURCE_CUTOVER.md).

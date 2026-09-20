# Private-source cutover

This is a one-time operational runbook for changing
`Charleyli925/Stemmio` from public to private. It is not a replacement for the
normal protected-branch, Candidate or Release gates.

## Preconditions

Do not change repository visibility until all of the following are true:

1. The private-source migration Pull Request is merged at the exact protected
   `main` head and `main-integrity` is green.
2. `Charleyli925/Stemmio-Releases` is public, has the public README, support,
   security policy and Issue templates, and private vulnerability reporting is
   enabled.
3. `STEMMIO_PUBLIC_RELEASES_TOKEN` is present only as a source-repository
   Actions secret. It is a short-lived fine-grained token restricted to
   `Stemmio-Releases` with **Contents: write**; it is not an administrator,
   classic broad-scope or source-repository token.
4. A new formal Stemmio release built from the migrated private-source branch
   has passed Candidate verification and appears in `Stemmio-Releases`, with
   DMG, ZIP, blockmap, `latest-mac.yml`, `SHA256SUMS.txt`, `build-info.json`,
   `release-candidate.json` and reviewed release notes. Verify a clean user
   can reach the public Release URL and read `latest-mac.yml`.
5. Current public downloads that must remain available have been copied to
   `Stemmio-Releases`. Do not remove or replace published public assets.
6. The source repository has no public forks requiring separate treatment and
   the owner has reviewed historical contributors and published license terms.

## Required final checks

GitHub keeps Actions history and logs associated with a formerly public
repository visible after a visibility change. Before the switch, inventory the
source repository's workflow runs and artifacts. Delete every run/artifact that
could expose source, paths, credentials, user-derived data or proprietary CI
evidence, retaining an internal record of the run IDs and reason. This deletion
is irreversible and requires an explicit operator confirmation for its exact
scope.

Then perform these checks in order:

1. Confirm no release workflow is running and that no pending candidate needs
   the old source repository Release surface.
2. Capture the exact source `main` SHA, source tag inventory, public release
   inventory and public-repository settings as internal evidence.
3. Change only `Charleyli925/Stemmio` to **Private** in GitHub Settings.
4. From an unauthenticated browser/session, confirm the source repository,
   source Releases, source Actions and source raw-file URLs are unavailable.
5. From an unauthenticated browser/session, confirm that
   `Stemmio-Releases`, its latest Release, support Issues, private-vulnerability
   reporting form and `latest-mac.yml` remain reachable.
6. Run the next formal release through Candidate and Publication, then verify
   its updater configuration resolves only to `Stemmio-Releases` and that the
   installed application opens the public distribution page rather than the
   private source repository.

## Historical limits

Changing visibility does not recall previously cloned source, copied assets or
versions previously published under Apache License 2.0. Those historical
materials remain governed by their original published terms. Do not claim that
the cutover erases or retroactively re-licenses them.

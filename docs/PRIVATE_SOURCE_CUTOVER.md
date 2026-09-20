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
   Actions secret. It is a short-lived fine-grained token restricted to the
   public `Stemmio-Releases` channel and the one-time
   `Charleyli925/PageRoot` legacy updater bridge, with **Contents: write**
   only; it is not an administrator, classic broad-scope or source-repository
   token.
4. A new formal Stemmio release built from the migrated private-source branch
   has passed Candidate verification and appears in `Stemmio-Releases`, with
   DMG, ZIP, blockmap, `latest-mac.yml`, `SHA256SUMS.txt`, `build-info.json`,
   `release-candidate.json` and reviewed release notes. Verify a clean user
   can reach the public Release URL and read `latest-mac.yml`. For `0.9.90`,
   verify the same exact asset set also appears in the public legacy updater
   bridge so signed `0.9.89` clients can reach the transition release.
5. Current public downloads that must remain available have been copied to
   `Stemmio-Releases`. Do not remove or replace published public assets.
6. The source repository has no public forks requiring separate treatment and
   the owner has reviewed historical contributors and published license terms.

## Required final checks

GitHub keeps Actions history and logs associated with a formerly public
repository visible after a visibility change. The operator has explicitly
chosen to retain every historical workflow run and artifact. Before the switch,
capture their inventory and do not delete, replace or shorten retention for
those historical records. This preserves already-public evidence but means the
cutover cannot erase historical log or artifact exposure; new private-source
workflows must never upload source, credentials, real user data or private
paths to a public destination.

Then perform these checks in order:

1. Confirm no release workflow is running and that no pending candidate needs
   the old source repository Release surface.
2. Capture the exact source `main` SHA, source tag inventory, public release
   inventory and public-repository settings as internal evidence.
3. Confirm the legacy updater bridge has only its README and exact `0.9.90`
   public Release; it must not contain source, Actions artifacts or support
   surfaces.
4. Change only `Charleyli925/Stemmio` to **Private** in GitHub Settings.
5. From an unauthenticated browser/session, confirm the source repository,
   source Releases and source raw-file URLs are unavailable. Confirm the
   retained historical Actions history, logs and artifacts have the documented
   historical visibility; do not falsely report that those retained records are
   private after the source visibility change.
6. From an unauthenticated browser/session, confirm that
   `Stemmio-Releases`, its latest Release, support Issues, private-vulnerability
   reporting form and `latest-mac.yml` remain reachable, and that the legacy
   updater bridge exposes only the transition assets.
7. Install `0.9.90` from the public distribution channel, then verify its
   updater configuration resolves only to `Stemmio-Releases` and that the
   installed application opens the public distribution page rather than the
   private source repository. The bridge is only the pre-`0.9.90` hop and does
   not authorize a second source or product channel.

## Historical limits

Changing visibility does not recall previously cloned source, copied assets or
versions previously published under Apache License 2.0. Those historical
materials remain governed by their original published terms. Do not claim that
the cutover erases or retroactively re-licenses them.

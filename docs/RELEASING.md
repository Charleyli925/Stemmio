# Release guide

Official releases use two explicit GitHub Actions stages from reviewed `main`:

1. `Release Candidate` builds and verifies the installer before a tag exists.
2. `Release` verifies those frozen bytes, creates the annotated immutable tag and publishes the same files.

Do not push a release tag manually. A tag is an output of successful candidate verification, not the input that starts packaging.

## Default source set for a latest installer

An unqualified request for the "latest installer" or "latest developer test
installer" means current `origin/main` plus the latest code from every
applicable Stemmio PR in the current development scope that the developer has
not explicitly excluded. A PR being open, draft, or closed without merge does
not exclude it. Merged changes arrive through `main`; unmerged heads are
combined on a temporary `integration/` branch without changing the source PRs.

Inventory the selected PR number and exact head OID before building. Record
explicitly excluded and superseded PRs with reasons. Stacked PRs must be
integrated in dependency order without applying the same commits twice. A
missing head or unresolved conflict blocks the build rather than producing a
silently incomplete package.

Any selected unmerged Pull Request makes the resulting installer a Developer
Preview with `releaseEligible: false`. Formal candidates and releases remain
restricted to reviewed `main`; if selected PR work is still outstanding, merge
it first or obtain an explicit developer exclusion. The package commands build
the exact clean current Tree and do not discover or merge PRs themselves, so
this source-composition step happens before the package gate.

## Credential-free PR release dry run

Ready candidates invoke `Release Dry Run` only when `candidate-context`
classifies their changed paths as able to affect packaging, release/build
metadata, Electron, packaged Bridge code, Schemas or bundled resources. Ordinary
UI or documentation-only candidates skip it successfully. Changed-file count is
reported only as advisory scope; it is never a PR-size rejection. The reusable
workflow can be manually dispatched for diagnosis but has no publication
authority and does not reference `secrets.*`.

The first clean macOS job builds the Electron renderer, generates exact
`build-info.json` plus an enabled telemetry configuration using a fixed
synthetic public-format token, assembles an explicitly unsigned `.app`, and reuses the formal
packaged verifier for app.asar, Bridge, Schema, resource, metadata, version and
Bundle ID checks. It freezes that App as a dedicated dry-run checkpoint whose
attestation always contains `releaseEligible: false`.

The same resource check confirms that the packaged application contains no
private Codex provider, App Server runtime or native Codex package. Codex's
external ACP managed-install closure is verified by the Agent catalog and is
not copied from the application root.

The second clean macOS job downloads and hash-verifies that checkpoint, restores
the embedded build and telemetry metadata, rebuilds the renderer comparison
oracle, revalidates the unchanged payload, then copies the App to a temporary
directory outside the checkout and every ancestor `node_modules`, launches that
staged App, and compares
`app.getName()`, `app.getVersion()` and `CFBundleIdentifier` with the source
package contract. Missing renderer output or telemetry metadata therefore fails
before merge.

This workflow never creates a DMG, ZIP, blockmap, update manifest, formal
Candidate, tag or GitHub Release. Its directory, archive, attestation filename
and `release-dry-run-checkpoint` kind are distinct from the signed-App
checkpoint; the formal Candidate verifier rejects a renamed dry-run
attestation. A successful dry run is early regression evidence only. The
formal Candidate still starts independently from reviewed `main`, requires the
real telemetry project token plus signing/notarization credentials, and never
downloads or reuses dry-run bytes.

## Optional developer preview

When the developer explicitly asks for an installable test package, manually
dispatch `Developer Preview` — its signing credential is the repository's
stable Developer ID pair (`MAC_CSC_LINK`/`MAC_CSC_KEY_PASSWORD` secrets) or a
Developer ID Application identity installed on the runner — or run
`npm run package:developer` on a clean committed tree with that identity
available in the local macOS keychain. The preview
requires that signature and stops if the certificate is missing or signing
fails; it never falls back to ad-hoc. Notarization remains optional for this
personal test package. It verifies packaged contents and performs one isolated
startup from a staged copy outside the checkout and every ancestor
`node_modules`, while its automatic update checks and installation path stay
disabled. The packaged verifier derives the required production-module closure
from imports in every Stemmio-owned packaged JavaScript file; adding a runtime
import without its declared, locked and copied closure fails before launch.
Its Actions artifact is retained for seven days and its
`developer-preview.json` always says `releaseEligible: false`.

The first Preview launch uses only its new roots (`~/Library/Application
Support/Stemmio Developer Preview`, `~/Documents/Stemmio Developer Preview`
and `~/Library/Logs/Stemmio Developer Preview`). Existing Stemmio data is not
scanned, migrated, copied, opened or deleted. Later Preview installs reuse this
new data. Source development and E2E use separate isolated roots; the formal
Stemmio release keeps its existing name, directories, signature and updater
behavior.

This step is optional. A request to make a formal candidate or publish a
release does not imply a developer preview, and the formal workflows never
depend on its result or reuse its DMG. See
`docs/DEVELOPER_PREVIEW_PLAYBOOK.md` for the exact trigger, installation and
failure boundaries.

Developer previews use a separate package identity: `Stemmio Developer
Preview`, a `.developer-preview` Bundle ID suffix, and a DMG name that includes
`Developer-Preview`. Their effective version is derived from the latest stable
tag and committed first-parent order: after `v0.9.5`, the first two readable
sequence prefixes are `0.9.69991` and `0.9.69992`. Each full preview version
adds the exact commit as `-dev.g<40 位 Commit SHA>`, so divergent branches can
never reuse an application or DMG version. The baseline must be an annotated,
remote `vA.B.C` release tag that points directly to a commit and matches the
release-tag contract; locally created semver-shaped tags are ignored. These
overrides apply only while building the preview and never change the source
package version or any formal candidate metadata.

## Mandatory installer delivery report

Every completed installer build, whether a formal candidate or a Developer
Preview, ends with an automated `package-delivery-report` step. The report is
generated only after artifact verification and startup checks and contains:

- the exact DMG file, version, architecture, byte size and SHA-256;
- the latest formal tag used as the content baseline, packaged Commit/Tree,
  commit count, changed-file count and diff totals;
- every Pull Request associated with commits in that range, its link, current
  GitHub open/draft/merged/mergeability/check status, and a one-line summary;
- every direct commit in the package range that GitHub cannot associate with a
  Pull Request.

The JSON and copy-ready Markdown are written below `output/` as
`package-delivery-report.json` and `package-delivery-report.md`; GitHub
workflows also append the Markdown to the run summary. PR state is live and can
change without changing package bytes, so this report is delivery metadata,
not an embedded application resource or immutable release attestation. Refresh
it against the same DMG immediately before a delayed handoff.

The agent's installer reply must reproduce the report's package identity,
content range and complete PR/direct-commit inventory. Each PR needs its
current state and one sentence describing its main change. It must also list
every explicitly excluded or superseded PR and the reason from the pre-build
source inventory. If GitHub metadata cannot be queried, a selected head is not
in the packaged Tree, or any included commit is omitted, packaging may have
succeeded technically but installer handoff is incomplete.

## Prepare the source

1. Update `package.json` and the package-lock root to the same semantic version.
2. Move relevant `CHANGELOG.md` entries from Unreleased into that version. That
   section becomes the published Release notes and the in-app “查看更新内容”
   destination, so write it for users; `npm run release:notes` renders exactly
   what they will read and fails when the section is missing or empty.
3. Open a draft Pull Request while iterating. Every ordinary Draft update runs impact-selected `pr-feedback` only. Batch accepted P0/P1 product corrections before promotion; review service status and unverified comments are informational. Verified P0/P1 defects block delivery under `docs/CODEX_WORKFLOW.md`, even with a green `release-gate`.
4. Update the final head onto current `main` and mark it Ready once, or add the `full-gate` label. That starts the complete source matrix. A PR opened already Ready also takes this path. Codex review is requested automatically for the current head and never blocks `release-gate`.
5. Wait for the complete source lanes, any relevant candidate-only dry run and required `release-gate`. The final gate refreshes the same dependency/runtime-closure audit before attestation. A later commit on a Ready PR reruns the complete matrix for the new head.
6. Merge only with authorization, then confirm `main-integrity` accepts the exact merge Tree/version/PR attestation without rerunning source tests.

Local `npm run release:mac` remains available when a complete local source-and-installer proof is useful. It is not publication and does not replace the reviewed GitHub flow.

## Build the pre-tag candidate

Before the first signed candidate, configure these GitHub Actions secrets
directly in the repository settings:

- `MAC_CSC_LINK`: base64-encoded Developer ID Application `.p12`.
- `MAC_CSC_KEY_PASSWORD`: the export password for that `.p12`.
- `APPLE_ID`: the Apple ID used for notarization.
- `APPLE_APP_SPECIFIC_PASSWORD`: a current app-specific password created for
  CI notarization.
- `STEMMIO_POSTHOG_TOKEN`: the `phc_…` Project token from the Stemmio
  PostHog project. Do not use a project secret API key.

Never paste those values into source, issues, Pull Requests, logs or chat. The
public Team ID is fixed to `RNK9RB969G` in the release workflow so a candidate
cannot silently switch signing teams.

Agent protocol acceptance is independent of source-gate green and of product
visibility. `shared/agent-protocol-acceptance.mjs` currently marks DeepSeek,
Qoder, Codex and every beta HTTP vendor `unverified`. Source-gate and Candidate
attestations must embed `agentProtocol` for the exact commit, package version
and platform, listing those rows as 未验收. A Candidate or Release without that
record, or with `accepted` backed only by `ci-synthetic`, is refused. CI mock
suites do not promote a vendor.

In GitHub Actions:

1. Select the `Release Candidate` workflow.
2. Choose `main`.
3. Run the workflow and wait for both `preflight-sign-and-notarize-app` and
   `package-and-verify-candidate`.

The candidate is deliberately split at a signed-App checkpoint. The first job
has a 90-minute guard and the second has a 75-minute guard. App notarization
and final-DMG notarization remain independent Apple submissions with narrow
45- and 50-minute step budgets. Checkout, dependency installation, source
evidence, checkpoint transfer, metadata, provenance and upload retain 2–10
minute limits.

The workflow:

- refuses any ref other than current `main`;
- requires a successful PR source-gate attestation for the exact Tree Hash and package/lockfile version, no older than seven days;
- requires the PostHog Project token and embeds a generated public ingestion
  configuration whose host is fixed to the selected cloud region;
- derives the stable GitHub provider and updater cache name from the reviewed
  package manifest, writes `app-update.yml` before App assembly, and rejects
  missing, extra or drifted channel fields before signing;
- first assembles one ad-hoc App with `electron-builder --publish never`, then
  verifies app.asar, Bridge, schemas, resources and the complete packaged
  runtime oracle before it exposes signing or Apple credentials to a build
  process;
- Developer ID signs that already-verified App, launches it once under
  Hardened Runtime and reuses the same product-name/version/Bundle-ID startup
  oracle before any Apple submission, then notarizes, staples and re-verifies
  it;
- archives the exact signed/notarized App plus source, payload and archive
  hashes as an attempt-qualified checkpoint retained for 14 days;
- starts a separate job from that checkpoint, validates every checkpoint byte,
  restores the exact embedded build, telemetry and application-update metadata
  as local comparison inputs, rebuilds only the deterministic renderer comparison output from the
  same source tree, and passes the unchanged App to electron-builder with
  `--prepackaged` rather than rebuilding it;
- creates the DMG, update ZIP, blockmap and `latest-mac.yml`, submits only the
  final DMG to Apple in that job, then verifies Team ID, tickets, Gatekeeper,
  DMG integrity, embedded provider configuration, updater metadata and read-only
  mounted/extracted contents;
- creates checksums for every public payload and metadata file, and copies
  `build-info.json`;
- freezes those files with `release-candidate.json` in an artifact named for the exact Tree Hash, version, architecture and workflow run attempt.
- generates the separate live package delivery report for the exact DMG and
  appends its PR inventory to the workflow summary before handoff.

It does not create a tag or GitHub Release. A failed build or verification therefore leaves the version namespace untouched.

Candidate artifacts and the internal signed-App checkpoint are retained for 14
days. Publication accepts only a successful matching candidate no older than
72 hours. If the source changes for any reason, build a new candidate for the
new Tree Hash.

If `package-and-verify-candidate` alone fails for an environment, transfer,
DMG-notary or final-asset reason, use **Re-run failed jobs**, not **Re-run all
jobs**. GitHub then reuses the successful attempt-qualified signed-App
checkpoint, so it does not rebuild, rerun the packaged runtime oracle, resign
or renotarize the App. A failure in the first job has no reusable checkpoint;
rerun that job only for a classified same-SHA environment incident. Any source
or test-script fix creates a new Tree and invalidates the old checkpoint.

## Publish the candidate

After reviewing the candidate run:

1. Select the `Release` workflow.
2. Choose `main`.
3. Enter the exact version from `package.json`, without the `v` prefix.
4. Run `publish-verified-candidate`.

The workflow:

1. verifies the requested version against `package.json` and the package-lock root;
2. resolves the published Release notes from the `## [<version>]` section of
   `CHANGELOG.md` and stops before any tag exists when that section is missing
   or empty;
3. resolves a fresh successful `Release Candidate` run for the exact current commit, Tree Hash, version and `arm64` architecture;
4. downloads the frozen candidate;
5. verifies the candidate attestation, build provenance, expected file set, sizes and SHA-256 of every asset;
6. checks that no published Release already exists;
7. creates an annotated `v<version>` tag at that exact commit;
8. publishes the candidate DMG, ZIP, ZIP blockmap, `latest-mac.yml`, checksum,
   build provenance and candidate attestation without rebuilding.

Release notes are the curated CHANGELOG section for that version, never an
automatically generated commit or Pull Request list: the in-app “查看更新内容”
entry opens exactly this page, so the notes are product copy rather than
engineering shorthand. Preview them at any time with
`npm run release:notes -- --version <x.y.z>`.

If publication fails after the tag push but before the GitHub Release exists, rerun the same `Release` workflow from the same `main` commit and version. It may resume only when the existing tag is annotated and resolves to the identical commit. If a Release already exists, the workflow refuses to replace its assets.

## Provenance

Packaging refuses committed-source drift or untracked source files. `build-info.json` records version, architecture, repository, commit SHA, Tree SHA and build time. `release-candidate.json` additionally binds the source-gate run, candidate run/attempt and SHA-256 plus size of every public asset.

Publication resolves only the artifact whose name matches the successful run attempt, then revalidates all of that information after downloading it. This keeps a failed-job rerun distinct from bytes uploaded by an earlier attempt of the same workflow run. The Release includes both provenance files, so the published installer can be traced to the reviewed source tree and the exact successful candidate run and attempt.

Before publication, the Release workflow regenerates the delivery report for
the downloaded verified DMG so the eventual release reply uses current PR
states without mutating the frozen candidate or its checksums.

The public build is signed with a Developer ID Application certificate,
notarized and stapled before it is frozen. If electron-builder lists the DMG in
`latest-mac.yml`, its digest and size are refreshed after stapling so every
listed artifact describes final bytes. electron-updater validates the release
metadata and application signature, uses a cached prior ZIP for differential
transfer when available, and falls back to a full ZIP when a differential
request cannot be completed.

## Failures

Use the machine evidence under `output/ci-evidence/` and the procedure in `docs/RELEASE_PIPELINE_GOVERNANCE.md`.

- Rerun only a failed job when the exact SHA and failure signature indicate a hosted-environment incident.
- Do not make no-op commits, enable blanket retries or restart a green matrix.
- After the same environment signature fails twice on one SHA without local reproduction, freeze the candidate and open a CI incident.
- Never move or reuse a published tag. If released source is wrong, fix it through a new PR and publish a new patch version.

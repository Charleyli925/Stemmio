# Dependency security

Dependency versions are pinned by `package-lock.json`, updated through Pull Requests and monitored by Dependabot. `npm run audit:dependencies` fails on any advisory that has not been explicitly reviewed or whose exception has expired, and also proves the packaged-runtime dependency closure. A promoted PR runs this command in `baseline-policy` after branch policy and writes a lockfile snapshot; `release-gate` verifies that snapshot instead of scanning again, so a delayed failed-job rerun cannot silently reuse stale advisory evidence unless the lockfile also changed. The `CI Health` workflow repeats the same baseline daily even when no PR is promoted.

## Update automation

Dependabot checks monthly. Coupled React packages are updated together, and minor or patch development-tool updates are grouped to reduce noisy or internally inconsistent Pull Requests. Automated version-update Pull Requests exclude all major upgrades; major dependency changes require a separately planned migration and full compatibility review. Every dependency Pull Request still requires the complete `release-gate` before merge, while security advisories remain governed by the audit policy below.

## Temporary reviewed exceptions

`echarts` 5.4.3 and 5.6.0 remain pinned because Stemmio resolves exact
cdnjs/jsDelivr/unpkg minified URLs for those two authored versions to their
same-version packaged bytes. GHSA-fgmj-fm8m-jvvx (CVE-2026-45249) is a
Lines-series tooltip XSS fixed only in 6.1.0, a major bump that would miss those
URLs. Both minified files load only inside the disposable author iframe, which
already executes trusted-local author scripts under ADR 0065. Review by 2026-11-28;
do not treat this exception as permission to widen packaged runtime or renderer
reachability.

## Reviewed fixes

The 2026-09-29 audit remediation updates the existing same-major overrides
for `fast-uri` from 3.1.6 to 3.1.7 and for `undici` from 7.29.0/6.28.0 to
7.29.1/6.28.1. These patch releases address GHSA-qw65-cvwx-89v3,
GHSA-58mr-gqgx-xq4g and GHSA-3wwx-pv8p-q78v without adding an exception or
changing the packaged runtime allowlist.

The 2026-09-09 merge gate remediation updates the single hoisted `js-yaml`
closure from 4.3.1 to 4.3.2 and applies a patch-level `sharp` 0.35.4 override
for both Next and Miniflare. This removes
[GHSA-2883-xcg3-v3hh](https://github.com/advisories/GHSA-2883-xcg3-v3hh)
and [GHSA-rgj7-g3m4-5g8c](https://github.com/advisories/GHSA-rgj7-g3m4-5g8c)
without a new exception. Sharp's matching platform/libvips packages update
together; the packaged updater continues to use one hoisted js-yaml/argparse
closure, and Sharp remains outside the packaged runtime allowlist.

The 2026-08-21 Qoder ACP Agent Bridge pins the official
`@agentclientprotocol/sdk` 1.3.0 and its direct `zod` 4.4.3 peer as production
dependencies. Electron Builder copies exactly those two packages into the
packaged Bridge resource closure; package tests, the artifact verifier and the
dependency audit reject a missing, nested or undeclared ACP runtime module.
They introduce no audit exception. The development-only synthetic probe reuses
the same restricted client but remains outside the packaged resource allowlist.

The 2026-08-14 security baseline moves the PostCSS-selected `nanoid` closure
to 3.3.18 and selects `vinext` 0.0.45 in place of 0.2.1. This is the
compatible remediation path identified by the audit; the release is verified
against this repository's Vite 8 and React 19.2 toolchain and does not depend
on `image-size`, removing
GHSA-2v37-7h3g-55p8, GHSA-w3rx-r6r6-pgpr and GHSA-5p2g-fcmc-qvqq without a
temporary exception. Vinext remains a development dependency and is not in the
packaged Electron runtime allowlist; that reduced reachability is not used as a
substitute for resolving the advisories.

The 2026-08-07 release patch moves the single hoisted `js-yaml` runtime and
tooling closure from 4.3.0 to the parent-compatible 4.3.1. This removes
GHSA-5p4m-2wfm-xmqj without adding an exception, changing Electron, or
introducing a nested packaged dependency.

The 2026-08-04 security convergence upgrades `next` and
`eslint-config-next` to 16.3.0, which refreshes the optional Sharp/libvips
closure to Sharp 0.35.3. It also resolves compatible `fast-uri`, PostCSS and
all affected `brace-expansion` lockfile entries. The separate `undici` fixes
stay within the parent-supported major: Miniflare receives 7.29.0 while
node-gyp receives 6.28.0. These constrained overrides keep the Cloudflare and
node-gyp toolchains compatible while removing their advisories. The audit now
returns zero vulnerabilities, so the prior Brace Expansion and Sharp
exceptions are removed from the executable allowlist.

The 2026-07-26 dependency convergence incorporates the complete contents of
open dependency PRs #9, #12 and #30, then verifies them with the current
architecture tree. React and `react-server-dom-webpack` are 19.2.8, parse5 is
8.0.1, and its shared runtime dependency `entities` is 8.0.0. Keeping one
hoisted `entities` version prevents the packaged Bridge from losing a nested
dependency that Electron Builder does not copy from inside another managed
module. The dependency audit rejects nested or incomplete packaged-runtime
closures before the artifact stage. The grouped development dependencies use
their reviewed patch or minor versions. The current same-major overrides select
PostCSS 8.5.25 and tar 7.5.22 for the build chain; related exceptions are
removed after `npm audit` no longer reports them.

The macOS package includes the compiled desktop renderer, selected desktop and
Bridge modules, `parse5`, `entities`, `@agentclientprotocol/sdk`, `zod`, the
reviewed `electron-updater` closure, schemas and build provenance; it explicitly
excludes the general `node_modules` tree, the private Codex provider/runtime and
all native Codex packages. Codex's adapter/native closure remains available only
through the catalog-managed ACP installer under `userData/agents`, where its
separate package identities and integrity pins are checked. `semver` is pinned
at the package root so the updater closure has no hidden nested runtime copy.
The dependency audit parses every Stemmio-owned JavaScript file selected for
`app.asar`, Bridge or shared resources, derives its direct bare-package imports,
expands their locked production and required peer dependencies, and requires
that exact hoisted set in `extraResources`. It rejects missing, nested,
undeclared or unreachable modules, so a new main-process import cannot be
hidden by forgetting to update a second hand-maintained allowlist.
The artifact verifier also walks every Stemmio-owned Resources subtree with
`lstat`, rejects symlinks and all non-regular entries (including FIFOs and Unix
sockets), rejects ASAR link entries, and byte-compares each allowlisted package
against the clean source closure. A packaged Electron Helper then starts the
packaged Bridge and completes a fake ACP task through the packaged official
finalizer to a pending-review Candidate; import-only evidence is insufficient.
These exceptions do not authorize adding the affected packages to the packaged
runtime.

Do not use `npm audit fix --force`: review every dependency update deliberately,
prefer compatible upstream fixes or narrow overrides, and rerun all source and
artifact gates after any dependency change.

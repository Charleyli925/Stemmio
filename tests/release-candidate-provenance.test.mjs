import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { agentProtocolReleaseSnapshot } from "../shared/agent-protocol-acceptance.mjs";
import {
  evaluateReleaseCandidateEvidence,
  releaseCandidateArtifactName,
  verifyReleaseCandidateBundle,
} from "../scripts/release-candidate-provenance.mjs";
import {
  fixtureBuildInfo,
  fixtureCandidateIdentity,
} from "./helpers/release-evidence-fixtures.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const candidateFixture = fixtureCandidateIdentity();
const {
  commitSha,
  treeSha,
  packageVersion,
} = candidateFixture;
const artifactName = releaseCandidateArtifactName(treeSha, packageVersion, "arm64", 1);
const now = new Date("2026-07-24T12:00:00.000Z");

function evidence(overrides = {}) {
  const identity = fixtureCandidateIdentity();
  return {
    currentCommitSha: identity.commitSha,
    currentTreeSha: identity.treeSha,
    packageVersion: identity.packageVersion,
    architecture: "arm64",
    workflowRuns: [{
      id: 501,
      event: "workflow_dispatch",
      status: "completed",
      conclusion: "success",
      head_sha: identity.commitSha,
      head_branch: "main",
      run_attempt: 1,
      updated_at: "2026-07-24T11:00:00.000Z",
    }],
    artifactsByRunId: {
      501: [{
        id: 601,
        name: releaseCandidateArtifactName(
          identity.treeSha,
          identity.packageVersion,
          "arm64",
          1,
        ),
        expired: false,
      }],
    },
    now,
    maxAgeHours: 72,
    ...overrides,
  };
}

test("release candidate identity binds tree, version, architecture and run attempt", () => {
  assert.equal(
    artifactName,
    `Stemmio-release-candidate-${treeSha}-${packageVersion}-arm64-attempt-1`,
  );
  assert.notEqual(
    artifactName,
    releaseCandidateArtifactName(treeSha, packageVersion, "arm64", 2),
  );
  assert.throws(
    () => releaseCandidateArtifactName("short", packageVersion, "arm64", 1),
    /40-character Git SHA/u,
  );
  assert.throws(
    () => releaseCandidateArtifactName(treeSha, packageVersion, "universal", 1),
    /architecture/u,
  );
  assert.throws(
    () => releaseCandidateArtifactName(treeSha, packageVersion, "arm64", 0),
    /positive integer/u,
  );
});

test("only a fresh successful main candidate with the exact artifact is reusable", () => {
  const result = evaluateReleaseCandidateEvidence(evidence());
  assert.equal(result.trusted, true);
  assert.equal(result.reason, "matching_release_candidate");
  assert.equal(result.runId, 501);
  assert.equal(result.runAttempt, 1);
  assert.equal(result.artifactName, artifactName);

  assert.equal(evaluateReleaseCandidateEvidence(evidence({
    currentTreeSha: "c".repeat(40),
  })).reason, "matching_candidate_artifact_missing");
  assert.equal(evaluateReleaseCandidateEvidence(evidence({
    workflowRuns: [{ ...evidence().workflowRuns[0], head_branch: "feature/not-main" }],
  })).reason, "no_successful_candidate_run");
  assert.equal(evaluateReleaseCandidateEvidence(evidence({
    now: new Date("2026-07-30T12:00:00.000Z"),
  })).reason, "candidate_stale");
  assert.equal(evaluateReleaseCandidateEvidence(evidence({
    artifactsByRunId: {
      501: [{ id: 601, name: artifactName, expired: true }],
    },
  })).reason, "matching_candidate_artifact_missing");
});

test("a rerun resolves only the artifact created by its exact run attempt", () => {
  const rerunArtifactName = releaseCandidateArtifactName(
    treeSha,
    packageVersion,
    "arm64",
    2,
  );
  const rerunResult = evaluateReleaseCandidateEvidence(evidence({
    workflowRuns: [{
      ...evidence().workflowRuns[0],
      run_attempt: 2,
    }],
    artifactsByRunId: {
      501: [
        { id: 601, name: artifactName, expired: false },
        { id: 602, name: rerunArtifactName, expired: false },
      ],
    },
  }));
  assert.equal(rerunResult.trusted, true);
  assert.equal(rerunResult.runAttempt, 2);
  assert.equal(rerunResult.artifactId, 602);
  assert.equal(rerunResult.artifactName, rerunArtifactName);

  assert.equal(evaluateReleaseCandidateEvidence(evidence({
    workflowRuns: [{
      ...evidence().workflowRuns[0],
      run_attempt: 2,
    }],
  })).reason, "matching_candidate_artifact_missing");
});

test("downloaded candidate verification rejects changed release bytes and malformed provenance", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "stemmio-release-candidate-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const builtAt = "2026-07-24T11:00:00.000Z";
  const identity = fixtureCandidateIdentity({ packageVersion });
  const zipName = `Stemmio-${packageVersion}-arm64.zip`;
  const files = {
    [`Stemmio-${packageVersion}-arm64.dmg`]: Buffer.from("synthetic dmg bytes"),
    [zipName]: Buffer.from("synthetic update zip bytes"),
    [`${zipName}.blockmap`]: Buffer.from("synthetic blockmap bytes"),
    "latest-mac.yml": Buffer.from(
      `version: ${packageVersion}\nfiles:\n  - url: ${zipName}\n    sha512: synthetic\n`,
    ),
    "build-info.json": Buffer.from(
      JSON.stringify(fixtureBuildInfo({
        version: packageVersion,
        architecture: "arm64",
        commitSha,
        treeSha,
        builtAt,
      }), null, 2) + "\n",
    ),
  };
  const dmgName = `Stemmio-${packageVersion}-arm64.dmg`;
  files["SHA256SUMS.txt"] = Buffer.from(
    `${Object.keys(files)
      .sort((left, right) => left.localeCompare(right))
      .map((name) => (
        `${createHash("sha256").update(files[name]).digest("hex")}  ${name}`
      ))
      .join("\n")}\n`,
  );
  await Promise.all(Object.entries(files).map(([name, contents]) => (
    writeFile(path.join(directory, name), contents)
  )));
  const assets = await Promise.all(Object.keys(files).map(async (name) => ({
    name,
    sha256: `sha256:${createHash("sha256").update(files[name]).digest("hex")}`,
    size: (await stat(path.join(directory, name))).size,
  })));
  const attestation = {
    schemaVersion: 1,
    repository: "Charleyli925/Stemmio",
    event: "workflow_dispatch",
    architecture: "arm64",
    candidateCommitSha: commitSha,
    candidateTreeSha: treeSha,
    packageVersion,
    packageLockVersion: packageVersion,
    sourceGate: {
      workflowRunId: 400,
      treeSha,
      packageVersion,
    },
    workflowRunId: 501,
    workflowRunAttempt: 1,
    artifactName,
    createdAt: now.toISOString(),
    assets,
    agentProtocol: agentProtocolReleaseSnapshot({
      commitSha,
      packageVersion,
      platform: "macos-arm64",
    }),
  };
  const attestationPath = path.join(directory, "release-candidate.json");
  await writeFile(
    attestationPath,
    JSON.stringify(attestation, null, 2) + "\n",
  );

  await assert.doesNotReject(() => verifyReleaseCandidateBundle({
    directory,
    identity,
    architecture: "arm64",
    repository: "Charleyli925/Stemmio",
    runId: 501,
    runAttempt: 1,
  }));
  const cases = [
    {
      name: "changed release byte",
      mutate: () => writeFile(path.join(directory, dmgName), "tampered"),
      expected: /asset bytes do not match/u,
    },
    {
      name: "candidate tree drift",
      mutate: () => writeFile(
        attestationPath,
        JSON.stringify({
          ...attestation,
          candidateTreeSha: "c".repeat(40),
        }, null, 2) + "\n",
      ),
      expected: /provenance mismatch for candidateTreeSha/u,
    },
    {
      name: "missing source-gate identity",
      mutate: () => {
        const withoutSourceGate = { ...attestation };
        delete withoutSourceGate.sourceGate;
        return writeFile(
          attestationPath,
          JSON.stringify(withoutSourceGate, null, 2) + "\n",
        );
      },
      expected: /source-gate identity does not match/u,
    },
    {
      name: "missing Agent protocol ledger",
      mutate: () => {
        const withoutProtocol = { ...attestation };
        delete withoutProtocol.agentProtocol;
        return writeFile(
          attestationPath,
          JSON.stringify(withoutProtocol, null, 2) + "\n",
        );
      },
      expected: /must list Agent protocol acceptance/u,
    },
    {
      name: "incomplete asset manifest",
      mutate: () => writeFile(
        attestationPath,
        JSON.stringify({
          ...attestation,
          assets: attestation.assets.slice(1),
        }, null, 2) + "\n",
      ),
      expected: /asset manifest has an unexpected shape/u,
    },
  ];
  for (const fixtureCase of cases) {
    await fixtureCase.mutate();
    await assert.rejects(
      () => verifyReleaseCandidateBundle({
        directory,
        identity,
        architecture: "arm64",
        repository: "Charleyli925/Stemmio",
        runId: 501,
        runAttempt: 1,
      }),
      fixtureCase.expected,
      fixtureCase.name,
    );
    await Promise.all([
      writeFile(path.join(directory, dmgName), files[dmgName]),
      writeFile(attestationPath, JSON.stringify(attestation, null, 2) + "\n"),
    ]);
  }
});

test("release workflows build before tagging and publish the verified candidate bytes", async () => {
  const [candidate, release] = await Promise.all([
    readFile(path.join(productRoot, ".github/workflows/release-candidate.yml"), "utf8"),
    readFile(path.join(productRoot, ".github/workflows/release.yml"), "utf8"),
  ]);
  assert.match(candidate, /workflow_dispatch/u);
  assert.match(candidate, /gate:candidate-app:auto/u);
  assert.match(candidate, /source-gate-provenance\.mjs verify/u);
  assert.match(candidate, /release-app-checkpoint\.mjs create/u);
  assert.match(candidate, /release-app-checkpoint\.mjs restore/u);
  assert.match(candidate, /--profile candidate-artifacts/u);
  assert.match(candidate, /release-candidate-provenance\.mjs create/u);
  assert.match(candidate, /MAC_CSC_LINK/u);
  assert.match(candidate, /APPLE_APP_SPECIFIC_PASSWORD/u);
  assert.match(candidate, /STEMMIO_REQUIRE_NOTARIZATION/u);
  assert.match(candidate, /STEMMIO_POSTHOG_TOKEN/u);
  assert.match(candidate, /https:\/\/us\.i\.posthog\.com/u);
  assert.match(
    candidate,
    /preflight-sign-and-notarize-app[\s\S]+timeout-minutes: 90[\s\S]+package-and-verify-candidate[\s\S]+timeout-minutes: 75/u,
  );
  assert.match(
    candidate,
    /run: npm ci\s+timeout-minutes: 10/u,
  );
  assert.match(
    candidate,
    /Upload exact candidate bundle[\s\S]+timeout-minutes: 10/u,
  );
  assert.doesNotMatch(candidate, /gate:artifact-only:auto/u);
  assert.doesNotMatch(candidate, /gh release create/u);
  assert.doesNotMatch(candidate, /git tag/u);

  assert.match(release, /workflow_dispatch/u);
  assert.match(release, /release-candidate-provenance\.mjs resolve/u);
  assert.match(release, /release-candidate-provenance\.mjs verify/u);
  assert.match(release, /git tag -a/u);
  assert.match(release, /gh release create/u);
  assert.match(release, /STEMMIO_PUBLIC_RELEASES_TOKEN/u);
  assert.match(release, /PUBLIC_RELEASES_REPOSITORY:\s*Charleyli925\/Stemmio-Releases/u);
  assert.match(release, /LEGACY_UPDATE_BRIDGE_REPOSITORY:\s*Charleyli925\/PageRoot/u);
  assert.match(release, /LEGACY_UPDATE_BRIDGE_VERSION:\s*0\.9\.90/u);
  assert.match(release, /--jq '\.full_name'/u);
  assert.match(release, /gh release create[\s\S]+--repo "\$repository"/u);
  assert.match(release, /publish_release "\$PUBLIC_RELEASES_REPOSITORY" false/u);
  assert.match(
    release,
    /if \[ "\$VERSION" = "\$LEGACY_UPDATE_BRIDGE_VERSION" \]; then[\s\S]+publish_release "\$LEGACY_UPDATE_BRIDGE_REPOSITORY" true/u,
  );
  assert.match(release, /verify_existing_legacy_bridge/u);
  assert.doesNotMatch(release, /gh release create[\s\S]+--repo "\$GITHUB_REPOSITORY"/u);
  assert.match(release, /Stemmio-\$\{VERSION\}-arm64\.zip/u);
  assert.match(release, /Stemmio-\$\{VERSION\}-arm64\.zip\.blockmap/u);
  assert.match(release, /latest-mac\.yml/u);
  assert.match(
    release,
    /release-candidate-provenance\.mjs verify[\s\S]+git tag -a[\s\S]+gh release create/u,
  );
  assert.doesNotMatch(release, /npm run release:mac/u);
  assert.doesNotMatch(release, /gate:artifact-only:auto/u);
});

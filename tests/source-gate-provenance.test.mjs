import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  classifyMissingAssociation,
  evaluateSourceGateEvidence,
  parsePullRequestNumberFromSubject,
  pullRequestMatchesCommit,
  readPackageVersions,
  sourceGateArtifactName,
} from "../scripts/source-gate-provenance.mjs";
import { fixtureSourceGateIdentity } from "./helpers/release-evidence-fixtures.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function workflowJob(workflow, jobId) {
  const marker = `  ${jobId}:\n`;
  const start = workflow.indexOf(marker);
  assert.notEqual(start, -1, `${jobId} job must exist`);
  const remainder = workflow.slice(start + marker.length);
  const nextJob = remainder.search(/^  [a-z0-9-]+:\n/mu);
  return nextJob === -1 ? remainder : remainder.slice(0, nextJob);
}
const sourceFixture = fixtureSourceGateIdentity();
const {
  currentTreeSha: treeSha,
  packageVersion,
} = sourceFixture;
const artifactName = sourceGateArtifactName(treeSha, packageVersion);

function evidence(overrides = {}) {
  const identity = fixtureSourceGateIdentity();
  return {
    currentCommitSha: identity.currentCommitSha,
    currentTreeSha: identity.currentTreeSha,
    packageVersion: identity.packageVersion,
    pullRequests: [{
      number: 25,
      merged_at: "2026-07-23T11:00:00.000Z",
      merge_commit_sha: identity.currentCommitSha,
      base: { ref: "main" },
      head: { sha: identity.headSha },
    }],
    workflowRuns: [{
      id: 300,
      event: "pull_request",
      status: "completed",
      conclusion: "success",
      head_sha: identity.headSha,
      updated_at: "2026-07-23T11:30:00.000Z",
    }],
    artifactsByRunId: {
      300: [{
        id: 901,
        name: sourceGateArtifactName(
          identity.currentTreeSha,
          identity.packageVersion,
        ),
        expired: false,
      }],
    },
    now: identity.now,
    maxAgeHours: identity.maxAgeHours,
    ...overrides,
  };
}

test("source gate artifact name binds the exact Git tree and package version", () => {
  assert.equal(
    artifactName,
    `Stemmio-source-gate-${treeSha}-${packageVersion}`,
  );
  assert.throws(() => sourceGateArtifactName("short", packageVersion), /40-character Git SHA/u);
});

test("package and lockfile versions must match before provenance can be reused", () => {
  assert.deepEqual(
    readPackageVersions(
      { version: packageVersion },
      { version: packageVersion, packages: { "": { version: packageVersion } } },
    ),
    { packageVersion, lockVersion: packageVersion },
  );
  assert.throws(
    () => readPackageVersions(
      { version: "0.8.5" },
      { packages: { "": { version: packageVersion } } },
    ),
    /does not match/u,
  );
});

test("matching merged PR, successful run, tree artifact and fresh age are trusted", () => {
  const result = evaluateSourceGateEvidence(evidence());
  assert.equal(result.trusted, true);
  assert.equal(result.reason, "matching_source_gate");
  assert.equal(result.pullRequestNumber, 25);
  assert.equal(result.runId, 300);
  assert.equal(result.artifactName, artifactName);
});

test("a different main tree cannot reuse a successful PR run", () => {
  const result = evaluateSourceGateEvidence(evidence({
    currentTreeSha: "d".repeat(40),
  }));
  assert.equal(result.trusted, false);
  assert.equal(result.reason, "matching_attestation_missing");
});

test("stale source evidence requires the complete source gate again", () => {
  const result = evaluateSourceGateEvidence(evidence({
    now: new Date("2026-08-01T12:00:00.000Z"),
  }));
  assert.equal(result.trusted, false);
  assert.equal(result.reason, "source_gate_stale");
});

test("failed runs, expired artifacts and non-PR commits are never trusted", () => {
  assert.equal(evaluateSourceGateEvidence(evidence({
    workflowRuns: [{ ...evidence().workflowRuns[0], conclusion: "failure" }],
  })).reason, "no_successful_source_gate");
  assert.equal(evaluateSourceGateEvidence(evidence({
    artifactsByRunId: {
      300: [{ id: 901, name: artifactName, expired: true }],
    },
  })).reason, "matching_attestation_missing");
  assert.equal(evaluateSourceGateEvidence(evidence({
    pullRequests: [],
  })).reason, "no_merged_pull_request");
});

test("a squash subject carries its own pull-request number", () => {
  assert.equal(
    parsePullRequestNumberFromSubject("chore(gate): ratchet the repository gate (#209)"),
    209,
  );
  assert.equal(parsePullRequestNumberFromSubject("fix: subject without a reference"), null);
  assert.equal(
    parsePullRequestNumberFromSubject("(#12) leading reference is not a squash suffix"),
    null,
  );
  assert.equal(parsePullRequestNumberFromSubject(""), null);
});

test("only a merged same-commit main pull request matches the commit", () => {
  const commitSha = "a".repeat(40);
  const merged = {
    merged_at: "2026-07-23T11:00:00.000Z",
    merge_commit_sha: commitSha,
    base: { ref: "main" },
  };
  assert.equal(pullRequestMatchesCommit(merged, commitSha), true);
  assert.equal(pullRequestMatchesCommit({ ...merged, merged_at: null }, commitSha), false);
  assert.equal(
    pullRequestMatchesCommit({ ...merged, merge_commit_sha: "b".repeat(40) }, commitSha),
    false,
  );
  assert.equal(
    pullRequestMatchesCommit({ ...merged, base: { ref: "release" } }, commitSha),
    false,
  );
  assert.equal(pullRequestMatchesCommit(null, commitSha), false);
});

test("a named pull request that does not match stays a hard mismatch while empty association is warn-eligible", () => {
  assert.equal(
    classifyMissingAssociation({ parsedNumber: 204, parsedPullRequest: { merged_at: null } }),
    "pull_request_mismatch",
  );
  assert.equal(
    classifyMissingAssociation({ parsedNumber: null, parsedPullRequest: null }),
    "association_unavailable",
  );
  assert.equal(
    classifyMissingAssociation({ parsedNumber: 204, parsedPullRequest: null }),
    "association_unavailable",
  );
});

test("GitHub workflows keep one CI file, informational Codex review, and exact-tree release provenance", async () => {
  const [ci, dryRun, candidate, release, packageText, npmAction] = await Promise.all([
    readFile(path.join(productRoot, ".github/workflows/ci.yml"), "utf8"),
    readFile(path.join(productRoot, ".github/workflows/release-dry-run.yml"), "utf8"),
    readFile(path.join(productRoot, ".github/workflows/release-candidate.yml"), "utf8"),
    readFile(path.join(productRoot, ".github/workflows/release.yml"), "utf8"),
    readFile(path.join(productRoot, "package.json"), "utf8"),
    readFile(path.join(productRoot, ".github/actions/setup-stemmio-npm/action.yml"), "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);
  const prFeedbackPlan = workflowJob(ci, "pr-feedback-plan");
  const prFeedbackLinux = workflowJob(ci, "pr-feedback-linux");
  const prFeedbackDesktop = workflowJob(ci, "pr-feedback-desktop");
  const prFeedback = workflowJob(ci, "pr-feedback");
  const codexReview = workflowJob(ci, "codex-review");
  const candidateContext = workflowJob(ci, "candidate-context");
  const baselinePolicy = workflowJob(ci, "baseline-policy");
  const sourceBuild = workflowJob(ci, "source-build");
  const sourceNode = workflowJob(ci, "source-node");
  const sourceBrowser = workflowJob(ci, "source-browser");
  const electronNative = workflowJob(ci, "source-electron-native");
  const electronAi = workflowJob(ci, "source-electron-ai");
  const releaseDryRun = workflowJob(ci, "release-dry-run");
  const releaseGate = workflowJob(ci, "release-gate");

  assert.match(ci, /types: \[opened, synchronize, reopened, ready_for_review\]/u);
  assert.doesNotMatch(ci, /workflow_dispatch/u);
  assert.doesNotMatch(ci, /pull_request_target/u);
  assert.doesNotMatch(ci, /contents: write|issues: write/u);
  assert.match(ci, /pull-requests: write/u);
  assert.doesNotMatch(ci, /gh pr merge|mergePullRequest/u);
  assert.doesNotMatch(ci, /full-gate/u);
  assert.match(ci, /name: pr-feedback/u);
  assert.match(prFeedbackPlan, /--for draft/u);
  assert.match(prFeedbackPlan, /planned_selection/u);
  assert.doesNotMatch(prFeedbackPlan, /setup-stemmio-npm/u);
  assert.match(prFeedbackLinux, /github\.event\.pull_request\.draft == true/u);
  assert.match(prFeedbackLinux, /needs: pr-feedback-plan/u);
  assert.match(prFeedbackLinux, /npm run gate:draft -- --base "\$PR_BASE_SHA" --runtime node,browser[\s\S]*--planned-selection/u);
  assert.match(prFeedbackLinux, /--stage pr-feedback/u);
  assert.match(prFeedbackLinux, /skip-electron: "true"/u);
  assert.match(prFeedbackLinux, /Upload Linux Playwright diagnostics[\s\S]*if: failure\(\) \|\| cancelled\(\)[\s\S]*path: output\/playwright/u);
  assert.doesNotMatch(prFeedbackLinux, /Restore Electron download cache/u);
  assert.match(prFeedbackDesktop, /needs\.pr-feedback-plan\.outputs\.has_desktop == 'true'/u);
  assert.doesNotMatch(prFeedbackDesktop, /needs:[\s\S]*pr-feedback-linux/u);
  assert.match(prFeedbackDesktop, /npm run gate:draft -- --base "\$PR_BASE_SHA" --runtime electron,ai[\s\S]*--planned-selection/u);
  assert.match(prFeedbackDesktop, /Upload desktop Playwright diagnostics[\s\S]*if: failure\(\) \|\| cancelled\(\)[\s\S]*path: output\/playwright/u);
  assert.match(prFeedback, /HAS_DESKTOP: \$\{\{ needs\.pr-feedback-plan\.outputs\.has_desktop \}\}/u);
  assert.match(codexReview, /continue-on-error: true/u);
  assert.match(codexReview, /request-codex-review\.mjs/u);
  assert.match(codexReview, /check-pr-review-policy\.mjs/u);
  assert.doesNotMatch(codexReview, /--settle-seconds|--timeout-seconds 900|--mode wait/u);
  assert.match(candidateContext, /classify-pr-candidate\.mjs/u);
  assert.match(candidateContext, /advisory_only|PR-size limit/u);
  assert.match(baselinePolicy, /name: baseline-policy/u);
  assert.match(baselinePolicy, /needs:[\s\S]*- branch-policy/u);
  assert.doesNotMatch(baselinePolicy, /review-policy|codex-review/u);
  assert.match(
    baselinePolicy,
    /npm ci --omit=dev --ignore-scripts --no-audit --no-fund[\s\S]*check-dependency-audit\.mjs/u,
  );
  assert.match(baselinePolicy, /check-dependency-audit\.mjs/u);
  assert.match(baselinePolicy, /--write-snapshot output\/ci-evidence\/dependency-audit\.json/u);
  assert.match(ci, /name: linux-deps/u);
  assert.match(ci, /name: macos-deps/u);
  assert.match(npmAction, /ELECTRON_SKIP_BINARY_DOWNLOAD/u);
  assert.match(npmAction, /install-mode == 'require-cache'/u);
  assert.match(sourceBuild, /needs:[\s\S]*- baseline-policy[\s\S]*- linux-deps/u);
  assert.match(sourceBuild, /skip-electron: "true"/u);
  assert.doesNotMatch(sourceBuild, /Restore Electron download cache/u);
  assert.match(sourceBuild, /npm run ci:source-build/u);
  assert.doesNotMatch(sourceBuild, /ci:source-build:prepared/u);
  assert.match(sourceBuild, /name: Stemmio-web-build-\$\{\{ github\.run_id \}\}/u);
  assert.match(sourceBuild, /retention-days: 30/u);
  assert.match(sourceBuild, /overwrite: true/u);
  assert.doesNotMatch(sourceBuild, /Stemmio-web-build-[^\n]*run_attempt/u);
  assert.match(sourceNode, /name: Stemmio-web-build-\$\{\{ github\.run_id \}\}/u);
  assert.match(sourceBrowser, /name: Stemmio-web-build-\$\{\{ github\.run_id \}\}/u);
  assert.match(sourceBrowser, /skip-electron: "true"/u);
  assert.doesNotMatch(sourceBrowser, /Restore Electron download cache/u);
  assert.match(
    sourceBrowser,
    /Upload browser failure diagnostics[\s\S]{0,200}if: failure\(\) \|\| cancelled\(\)/u,
  );
  assert.match(electronNative, /needs:[\s\S]*- baseline-policy[\s\S]*- macos-deps/u);
  assert.match(electronAi, /needs:[\s\S]*- baseline-policy[\s\S]*- macos-deps/u);
  assert.match(releaseGate, /name:.*draft == false.*'release-gate'.*'release-gate-inactive'/u);
  assert.match(releaseGate, /\$\{\{ always\(\)/u);
  assert.doesNotMatch(releaseGate, /!cancelled\(\)/u);
  assert.doesNotMatch(releaseGate, /review-policy|codex-review/u);
  assert.match(releaseGate, /needs:[\s\S]*- candidate-context[\s\S]*- release-dry-run/u);
  assert.match(releaseGate, /BASELINE_RESULT: \$\{\{ needs\.baseline-policy\.result \}\}/u);
  assert.doesNotMatch(releaseGate, /Revalidate frozen head\/base|--mode revalidate/u);
  assert.match(
    releaseGate,
    /npm ci --omit=dev --ignore-scripts --no-audit --no-fund[\s\S]*Verify dependency and packaged-runtime baseline is unchanged/u,
  );
  assert.match(releaseGate, /Verify dependency and packaged-runtime baseline is unchanged/u);
  assert.match(releaseGate, /--verify-snapshot output\/ci-evidence\/dependency-audit\.json/u);
  assert.doesNotMatch(releaseGate, /npm run audit:dependencies/u);
  assert.match(releaseGate, /Download product flaky evidence/u);
  assert.match(releaseGate, /Stemmio-\*-evidence-\$\{\{ github\.run_id \}\}-\*/u);
  assert.match(releaseGate, /select-source-gate-evidence\.mjs/u);
  assert.match(releaseGate, /path: output\/ci-evidence-attempts/u);
  assert.match(releaseGate, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/u);
  assert.match(ci, /source-gate-provenance\.mjs create/u);
  assert.match(releaseGate, /--evidence-dir output\/ci-evidence/u);
  assert.match(ci, /steps\.provenance\.outputs\.artifact_name/u);
  assert.match(ci, /runs-on: ubuntu-24\.04/u);
  assert.match(ci, /runs-on: macos-14/u);
  assert.match(ci, /--shard=1\/3/u);
  assert.match(ci, /--shard=2\/3/u);
  assert.match(ci, /--shard=3\/3/u);
  assert.match(ci, /--fully-parallel --workers=1/u);
  assert.match(ci, /name: electron-native/u);
  assert.match(ci, /name: electron-ai/u);
  assert.doesNotMatch(ci, /name: electron-renderer/u);
  assert.match(ci, /test:electron:ci-preflight/u);
  assert.doesNotMatch(ci, /test:electron:ci-preflight:prepared/u);
  assert.match(ci, /--stage environment-preflight/u);
  assert.match(ci, /npm run desktop:renderer/u);
  assert.doesNotMatch(ci, /dist-desktop/u);
  assert.doesNotMatch(ci, /Download shared source build/u);
  assert.match(electronNative, /playwright-flaky-summary\.mjs/u);
  assert.match(electronNative, /--suite electron-native-\$\{\{ matrix\.label \}\}/u);
  assert.match(electronNative, /--report output\/playwright\/native-dom-electron\/results\.json/u);
  // Playwright shards by spec file unless --fully-parallel raises sharding to
  // test granularity, and this suite has only two spec files. Each runner
  // keeps one worker so no two Electron apps share a runner, and every shard
  // needs a collision-free artifact name.
  assert.match(
    electronNative,
    /--fully-parallel --workers=1 --shard=\$\{\{ matrix\.shard \}\}/u,
  );
  assert.match(electronNative, /fail-fast: false/u);
  for (const shard of ["1", "2", "3"]) {
    assert.match(electronNative, new RegExp(`shard: ${shard}\\/3`, "u"));
  }
  assert.match(
    electronNative,
    /name: Stemmio-electron-native-\$\{\{ matrix\.label \}\}-diagnostics-/u,
  );
  assert.match(
    electronNative,
    /name: Stemmio-electron-native-\$\{\{ matrix\.label \}\}-evidence-/u,
  );
  assert.match(electronNative, /Upload native Electron diagnostics and retry evidence[\s\S]{0,200}if: failure\(\) \|\| cancelled\(\)/u);
  assert.match(electronAi, /playwright-flaky-summary\.mjs/u);
  assert.match(electronAi, /--suite electron-ai/u);
  assert.match(electronAi, /--report output\/playwright\/ai-closed-loop\/deterministic\/results\.json/u);
  assert.match(electronAi, /Upload AI Electron diagnostics and retry evidence[\s\S]{0,200}if: failure\(\) \|\| cancelled\(\)/u);
  assert.match(ci, /scripts\/ci-evidence\.mjs run/u);
  assert.match(ci, /Verify PR result, exact tree, version and freshness/u);
  assert.match(ci, /--missing-association fail/u);
  assert.doesNotMatch(ci, /--missing-association warn/u);
  assert.doesNotMatch(candidate, /--missing-association/u);
  assert.doesNotMatch(dryRun, /--missing-association/u);
  assert.doesNotMatch(ci, /name: main-smoke|gate:main:auto/u);
  assert.doesNotMatch(ci, /push:[\s\S]{0,300}gate:release:auto/u);
  // A superseded pull-request head is cancellable because only the newest
  // head can merge. Separate main commits are not: each needs its own
  // main-integrity verification, so a later merge must not cancel an earlier
  // commit's run.
  assert.match(
    ci,
    /format\('stemmio-pr-\{0\}', github\.event\.pull_request\.number \|\| github\.ref\)/u,
  );
  assert.match(ci, /format\('stemmio-main-\{0\}', github\.sha\)/u);
  assert.match(ci, /cancel-in-progress: \$\{\{ github\.event_name != 'push' \}\}/u);
  assert.equal(
    packageJson.scripts["ci:source-build"],
    "npm run typecheck && npm run lint && npm run build",
  );
  assert.equal(packageJson.scripts["ci:source-build:prepared"], undefined);
  assert.equal(packageJson.scripts["gate:artifact-only:auto"], undefined);
  assert.equal(packageJson.scripts["release:mac:x64"], undefined);

  assert.match(ci, /uses: \.\/\.github\/workflows\/release-dry-run\.yml/u);
  assert.match(releaseDryRun, /uses: \.\/\.github\/workflows\/release-dry-run\.yml/u);
  assert.doesNotMatch(releaseDryRun, /\bsecrets\s*:/u);
  assert.match(ci, /packaging_required == 'true'/u);
  assert.match(dryRun, /workflow_call:/u);
  assert.match(dryRun, /workflow_dispatch:/u);
  assert.doesNotMatch(dryRun, /^\s+pull_request:/mu);
  assert.match(dryRun, /ref: \$\{\{ inputs\.source_head \}\}/u);
  assert.match(dryRun, /persist-credentials: false/u);
  assert.doesNotMatch(dryRun, /secrets:|gh release create|APPLE_/u);

  assert.match(candidate, /source-gate-provenance\.mjs verify/u);
  assert.match(candidate, /gate:candidate-app:auto/u);
  assert.match(candidate, /STEMMIO_SOURCE_GATE_TRUSTED/u);
  assert.match(candidate, /STEMMIO_SOURCE_GATE_TREE/u);
  assert.match(candidate, /release-app-checkpoint\.mjs create/u);
  assert.match(candidate, /release-app-checkpoint\.mjs restore/u);
  assert.match(candidate, /--profile candidate-artifacts/u);
  assert.match(candidate, /release-candidate-provenance\.mjs create/u);
  assert.match(candidate, /test:electron:ci-preflight/u);
  assert.doesNotMatch(candidate, /test:electron:ci-preflight:prepared/u);
  assert.doesNotMatch(candidate, /npm run release:mac/u);
  assert.doesNotMatch(candidate, /gate:artifact-only:auto/u);
  assert.doesNotMatch(candidate, /gh release create/u);

  assert.match(release, /release-candidate-provenance\.mjs resolve/u);
  assert.match(release, /release-candidate-provenance\.mjs verify/u);
  assert.match(release, /gh release create/u);
  assert.match(release, /release-candidate\.json/u);
  assert.doesNotMatch(release, /tags:/u);
  assert.doesNotMatch(release, /source-gate-provenance\.mjs verify/u);
  assert.doesNotMatch(release, /gate:artifact-only:auto/u);
});

test("retired review-governance workflows are gone", async () => {
  const { readdir } = await import("node:fs/promises");
  const workflows = await readdir(path.join(productRoot, ".github/workflows"));
  assert.deepEqual(workflows.sort(), [
    "agent-vendor-smoke.yml",
    "ci-health.yml",
    "ci.yml",
    "developer-preview.yml",
    "release-candidate.yml",
    "release-dry-run.yml",
    "release.yml",
  ]);
});

function releaseGateScript(job, stepName) {
  const step = job.slice(job.indexOf(`      - name: ${stepName}\n`));
  assert.ok(step.startsWith(`      - name: ${stepName}\n`));
  const body = step.slice(step.indexOf("        run: |\n") + "        run: |\n".length);
  return body.split("\n").filter((line, index, lines) => {
    const end = lines.findIndex((candidate) => candidate.startsWith("      - "));
    return end === -1 || index < end;
  }).map((line) => line.replace(/^          /u, "")).join("\n");
}

test("the actual release-gate shell refuses failed, cancelled, skipped and missing required lanes", async () => {
  const ci = await readFile(path.join(productRoot, ".github/workflows/ci.yml"), "utf8");
  const script = releaseGateScript(workflowJob(ci, "release-gate"), "Require every source lane");
  const lanes = ["BASELINE_RESULT", "POLICY_RESULT", "CANDIDATE_CONTEXT_RESULT", "BUILD_RESULT",
    "NODE_RESULT", "BROWSER_RESULT", "ELECTRON_NATIVE_RESULT", "ELECTRON_AI_RESULT"];
  const passing = Object.fromEntries(lanes.map((lane) => [lane, "success"]));
  const run = (changes = {}) => spawnSync("bash", ["-e", "-o", "pipefail", "-c", script], {
    encoding: "utf8", env: { ...process.env, ...passing, GITHUB_STEP_SUMMARY: "/dev/null",
      PACKAGING_REQUIRED: "false", DRY_RUN_RESULT: "skipped", ...changes },
  });
  assert.equal(run().status, 0);
  assert.equal(run({ PACKAGING_REQUIRED: "true", DRY_RUN_RESULT: "success" }).status, 0);
  for (const lane of lanes) {
    for (const result of ["failure", "cancelled", "skipped", ""]) {
      assert.notEqual(run({ [lane]: result }).status, 0, `${lane}: ${result}`);
    }
  }
  for (const result of ["failure", "cancelled", "skipped", ""]) {
    assert.notEqual(run({ PACKAGING_REQUIRED: "true", DRY_RUN_RESULT: result }).status, 0);
  }
  assert.notEqual(run({ PACKAGING_REQUIRED: "" }).status, 0);
});

test("the attestation entry rejects Draft, stale head, stale base and a different tested merge", async () => {
  const ci = await readFile(path.join(productRoot, ".github/workflows/ci.yml"), "utf8");
  const script = releaseGateScript(workflowJob(ci, "release-gate"), "Create exact-tree source gate attestation")
    .split("node scripts/source-gate-provenance.mjs create")[0];
  const current = { state: "open", draft: false, head: { sha: "head" },
    base: { ref: "main", sha: "base" }, merge_commit_sha: "merge" };
  const doubles = `
    gh() { printf '%s' "$LIVE_PR"; }
    git() {
      case "$2" in
        HEAD) printf '%s' "$TESTED_MERGE" ;;
        HEAD^1) printf '%s' "$TESTED_BASE" ;;
        HEAD^2) printf '%s' "$TESTED_HEAD" ;;
        *) return 1 ;;
      esac
    }
  `;
  const run = (pr = current, changes = {}) => spawnSync("bash", ["-e", "-o", "pipefail", "-c", doubles + script], {
    encoding: "utf8", env: { ...process.env, LIVE_PR: JSON.stringify(pr),
      GITHUB_SHA: "merge", PR_BASE_SHA: "base", PR_HEAD_SHA: "head", PR_NUMBER: "1",
      GITHUB_REPOSITORY: "synthetic/repo", TESTED_MERGE: "merge", TESTED_BASE: "base", TESTED_HEAD: "head", ...changes },
  });
  assert.equal(run().status, 0);
  for (const changes of [{ draft: true }, { state: "closed" }, { head: { sha: "new-head" } },
    { base: { ref: "main", sha: "new-base" } }, { merge_commit_sha: "new-merge" }]) {
    assert.notEqual(run({ ...current, ...changes }).status, 0, JSON.stringify(changes));
  }
  for (const field of ["TESTED_MERGE", "TESTED_BASE", "TESTED_HEAD"]) {
    assert.notEqual(run(current, { [field]: "different" }).status, 0, field);
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  collectPullRequests,
  createPackageDeliverySnapshot,
  DEFAULT_PACKAGE_DELIVERY_DEADLINE_MS,
  isTransientGitHubCommandFailure,
  PackageDeliveryReportTimeoutError,
  parseArguments,
  pullRequestStatusLabel,
  renderPackageDeliveryMarkdown,
  retryTransientGitHubCommandAsync,
  retryTransientGitHubCommand,
  selectPackageBaseline,
  summarizeStatusChecks,
} from "../scripts/package-delivery-report.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const headSha = "a".repeat(40);
const treeSha = "b".repeat(40);

test("delivery evidence retries only bounded GitHub transport failures", () => {
  for (const failure of [
    new Error('Get "https://api.github.com/example": EOF'),
    Object.assign(new Error("spawnSync gh ETIMEDOUT"), { code: "ETIMEDOUT" }),
    new Error("gh failed: HTTP 503: temporarily unavailable"),
    new Error("Could not resolve host: api.github.com"),
    new Error("gh returned invalid JSON for /repos/x/commits/abc/pulls"),
    new SyntaxError("unexpected end of JSON input"),
    new Error("gh failed: HTTP 429: rate limit exceeded"),
    Object.assign(new Error("Command failed: gh api /repos/x/commits/abc/pulls"), {
      code: 1,
      stderr: "",
      stdout: "",
    }),
  ]) {
    assert.equal(isTransientGitHubCommandFailure(failure), true);
  }
  for (const failure of [
    new Error("gh failed: HTTP 401: Bad credentials"),
    new Error("gh failed: HTTP 404: Not Found"),
    new Error("GitHub commit Pull Request response must be an array"),
    Object.assign(new Error("Command failed: gh api /repos/x/pulls: gh: Not Found (HTTP 404)"), {
      code: 1,
      stderr: "gh: Not Found (HTTP 404)",
      stdout: "",
    }),
  ]) {
    assert.equal(isTransientGitHubCommandFailure(failure), false);
  }

  let transientAttempts = 0;
  const retries = [];
  assert.equal(retryTransientGitHubCommand(() => {
    transientAttempts += 1;
    if (transientAttempts < 3) throw new Error("GitHub request failed: EOF");
    return "ok";
  }, {
    attempts: 3,
    onRetry: (retry) => retries.push(retry),
  }), "ok");
  assert.equal(transientAttempts, 3);
  assert.deepEqual(retries.map(({ nextAttempt }) => nextAttempt), [2, 3]);

  let permanentAttempts = 0;
  assert.throws(() => retryTransientGitHubCommand(() => {
    permanentAttempts += 1;
    throw new Error("HTTP 401: Bad credentials");
  }), /Bad credentials/u);
  assert.equal(permanentAttempts, 1);

  let exhaustedAttempts = 0;
  assert.throws(() => retryTransientGitHubCommand(() => {
    exhaustedAttempts += 1;
    throw new Error("GitHub request failed: EOF");
  }, { attempts: 2 }), /EOF/u);
  assert.equal(exhaustedAttempts, 2);
});

test("delivery metadata is cached, bounded-concurrent and reports progress", async () => {
  const commitA = "a".repeat(40);
  const commitB = "b".repeat(40);
  const calls = [];
  const progress = [];
  const result = await collectPullRequests({
    root: productRoot,
    repository: "Charleyli925/Stemmio",
    commits: [
      { sha: commitA, subject: "first" },
      { sha: commitB, subject: "second" },
      { sha: commitA, subject: "duplicate input for cache" },
    ],
    concurrency: 2,
    deadlineMs: 5_000,
    onProgress: (event) => progress.push(event),
    requestJson: async (arguments_) => {
      calls.push(arguments_);
      if (arguments_[0] === "api") return [{ number: 10 }];
      return {
        number: 10,
        url: "https://github.com/Charleyli925/Stemmio/pull/10",
        title: "Cached metadata",
        state: "MERGED",
        isDraft: false,
        mergeStateStatus: "CLEAN",
        reviewDecision: "APPROVED",
        statusCheckRollup: [],
        headRefOid: commitB,
        mergedAt: "2026-08-28T00:00:00Z",
      };
    },
  });

  assert.equal(calls.filter((arguments_) => arguments_[0] === "api").length, 2);
  assert.equal(calls.filter((arguments_) => arguments_[0] === "pr").length, 1);
  assert.deepEqual(result.commits.map((commit) => commit.pullRequestNumbers), [[10], [10], [10]]);
  assert.deepEqual(result.pullRequests[0].commitShas, [commitA, commitB]);
  assert.equal(result.scan.commitMetadataRequested, 3);
  assert.equal(result.scan.commitMetadataCompleted, 3);
  assert.equal(result.scan.pullRequestMetadataCompleted, 1);
  assert.equal(result.scan.githubRequestCount, 3);
  assert.equal(result.scan.cacheHitCount, 1);
  assert.equal(result.scan.concurrency, 2);
  assert(progress.some((event) => event.phase === "commit metadata" && event.total === 3));
  assert(progress.some((event) => event.phase === "Pull Request metadata" && event.completed === 1));
});

test("delivery metadata has an explicit overall deadline and useful timeout progress", async () => {
  const commitSha = "c".repeat(40);
  await assert.rejects(
    collectPullRequests({
      root: productRoot,
      repository: "Charleyli925/Stemmio",
      commits: [{ sha: commitSha, subject: "deadline" }],
      deadlineAt: Date.now() - 1,
      deadlineMs: 123,
      onProgress: () => {},
      requestJson: async () => [],
    }),
    (error) => {
      assert(error instanceof PackageDeliveryReportTimeoutError);
      assert.equal(error.code, "PACKAGE_DELIVERY_REPORT_TIMEOUT");
      assert.match(error.message, /0\/1/u);
      assert.match(error.message, /current c{12}/u);
      return true;
    },
  );
});

test("delivery report keeps retrying transient async metadata inside its deadline", async () => {
  let attempts = 0;
  const retries = [];
  assert.equal(
    await retryTransientGitHubCommandAsync(async () => {
      attempts += 1;
      if (attempts === 1) throw Object.assign(new Error("transport EOF"), { code: "ECONNRESET" });
      return "ok";
    }, {
      deadlineAt: Date.now() + 5_000,
      deadlineMs: 5_000,
      onRetry: (retry) => retries.push(retry),
    }),
    "ok",
  );
  assert.equal(attempts, 2);
  assert.deepEqual(retries.map(({ nextAttempt }) => nextAttempt), [2]);
});

test("package delivery arguments expose the bounded default and an override", () => {
  const options = parseArguments([
    "--kind", "formal",
    "--artifact", "release/Stemmio.dmg",
    "--version", "0.9.8",
    "--architecture", "arm64",
    "--deadline-ms", "12345",
  ]);
  assert.equal(options.deadlineMs, 12345);
  assert.equal(
    parseArguments([
      "--kind", "formal",
      "--artifact", "release/Stemmio.dmg",
      "--version", "0.9.8",
      "--architecture", "arm64",
    ]).deadlineMs,
    DEFAULT_PACKAGE_DELIVERY_DEADLINE_MS,
  );
});

test("formal reports use the prior stable tag when packaging an exact tagged commit", () => {
  assert.equal(
    selectPackageBaseline({
      tags: ["v0.9.5", "v0.9.4"],
      tagCommits: {
        "v0.9.5": headSha,
        "v0.9.4": "c".repeat(40),
      },
      headSha,
      kind: "formal",
    }),
    "v0.9.4",
  );
  assert.equal(
    selectPackageBaseline({
      tags: ["v0.9.5", "v0.9.4"],
      tagCommits: {
        "v0.9.5": "d".repeat(40),
        "v0.9.4": "c".repeat(40),
      },
      headSha,
      kind: "developer-preview",
    }),
    "v0.9.5",
  );
});

test("Pull Request status includes readiness, mergeability and live checks", () => {
  const checks = summarizeStatusChecks([
    {
      __typename: "CheckRun",
      status: "COMPLETED",
      conclusion: "SUCCESS",
    },
    {
      __typename: "CheckRun",
      status: "COMPLETED",
      conclusion: "FAILURE",
    },
    {
      __typename: "CheckRun",
      status: "COMPLETED",
      conclusion: "SKIPPED",
    },
  ]);
  assert.deepEqual(checks, {
    total: 3,
    passing: 1,
    failing: 1,
    pending: 0,
    skipped: 1,
    status: "FAILING",
  });
  assert.equal(
    pullRequestStatusLabel({
      state: "OPEN",
      isDraft: false,
      mergeStateStatus: "BLOCKED",
      reviewDecision: "REVIEW_REQUIRED",
      checks,
    }),
    "开放 · 可审查 · 合并受阻 · 待审查 · 检查失败",
  );
  assert.equal(pullRequestStatusLabel({ state: "MERGED" }), "已合并");
});

test("delivery Markdown reports exact package bytes, every PR and direct commits", () => {
  const pullRequests = [{
    number: 84,
    url: "https://github.com/Charleyli925/Stemmio/pull/84",
    title: "Distinguish developer preview packages and versions",
    summary: "Distinguish developer preview packages and versions",
    state: "OPEN",
    isDraft: false,
    mergeStateStatus: "BLOCKED",
    reviewDecision: null,
    checks: {
      total: 1,
      passing: 0,
      failing: 1,
      pending: 0,
      skipped: 0,
      status: "FAILING",
    },
    statusLabel: "开放 · 可审查 · 合并受阻 · 检查失败",
    commitShas: [headSha],
  }];
  const report = createPackageDeliverySnapshot({
    kind: "developer-preview",
    artifact: {
      file: "Stemmio-Developer-Preview-0.9.69993-arm64.dmg",
      path: "output/developer-preview/release/Stemmio-Developer-Preview-0.9.69993-arm64.dmg",
      version: "0.9.69993",
      architecture: "arm64",
      size: 123,
      sha256: "f".repeat(64),
    },
    repository: "Charleyli925/Stemmio",
    baseTag: "v0.9.5",
    headSha,
    treeSha,
    commits: [
      {
        sha: headSha,
        subject: "feat: package report",
        pullRequestNumbers: [84],
      },
      {
        sha: "c".repeat(40),
        subject: "chore: direct package adjustment",
        pullRequestNumbers: [],
      },
    ],
    changedFiles: ["AGENTS.md", "scripts/package-delivery-report.mjs"],
    additions: 120,
    deletions: 4,
    pullRequests,
    scan: {
      deadlineMs: 480000,
      concurrency: 8,
      commitMetadataRequested: 2,
      commitMetadataCompleted: 2,
      pullRequestMetadataRequested: 1,
      pullRequestMetadataCompleted: 1,
    },
    generatedAt: "2026-08-04T06:00:00.000Z",
  });
  const markdown = renderPackageDeliveryMarkdown(report);
  assert.match(markdown, /Stemmio-Developer-Preview-0\.9\.69993-arm64\.dmg/u);
  assert.match(markdown, /2 个提交、2 个文件（\+120 \/ -4）/u);
  assert.match(markdown, /\[#84\]\(https:\/\/github\.com\/Charleyli925\/Stemmio\/pull\/84\)/u);
  assert.match(markdown, /开放 · 可审查 · 合并受阻 · 检查失败/u);
  assert.match(markdown, /chore: direct package adjustment/u);
  assert.match(markdown, /GitHub 元数据扫描：2\/2 个提交、1\/1 个 PR；8 并发/u);
});

test("installer workflows generate a live delivery report after package verification", async () => {
  const [
    preview,
    candidate,
    release,
    agentGuide,
    releasing,
    playbook,
    gitWorkflow,
    codexWorkflow,
    development,
  ] = await Promise.all([
    readFile(path.join(productRoot, ".github/workflows/developer-preview.yml"), "utf8"),
    readFile(path.join(productRoot, ".github/workflows/release-candidate.yml"), "utf8"),
    readFile(path.join(productRoot, ".github/workflows/release.yml"), "utf8"),
    readFile(path.join(productRoot, "AGENTS.md"), "utf8"),
    readFile(path.join(productRoot, "docs/RELEASING.md"), "utf8"),
    readFile(path.join(productRoot, "docs/DEVELOPER_PREVIEW_PLAYBOOK.md"), "utf8"),
    readFile(path.join(productRoot, "docs/GIT_WORKFLOW.md"), "utf8"),
    readFile(path.join(productRoot, "docs/CODEX_WORKFLOW.md"), "utf8"),
    readFile(path.join(productRoot, "docs/DEVELOPMENT.md"), "utf8"),
  ]);
  assert.match(preview, /GH_TOKEN:\s*\$\{\{ github\.token \}\}/u);
  assert.match(preview, /package-delivery-report\.md/u);
  assert.match(candidate, /package-delivery-report\.mjs/u);
  assert.match(candidate, /output\/package-delivery/u);
  assert.match(release, /package-delivery-report\.mjs/u);
  assert.match(release, /STEMMIO_PUBLIC_RELEASES_TOKEN/u);
  assert.match(release, /PUBLIC_RELEASES_REPOSITORY:\s*Charleyli925\/Stemmio-Releases/u);
  assert.match(release, /LEGACY_UPDATE_BRIDGE_REPOSITORY:\s*Charleyli925\/PageRoot/u);
  assert.match(release, /LEGACY_UPDATE_BRIDGE_VERSION:\s*0\.9\.90/u);
  assert.match(release, /--repo "\$repository"/u);
  assert.match(release, /publish_release "\$PUBLIC_RELEASES_REPOSITORY" false/u);
  assert.match(release, /--target main/u);
  assert.doesNotMatch(release, /--verify-tag/u);
  assert.match(agentGuide, /docs\/CODEX_WORKFLOW\.md/u);
  assert.match(codexWorkflow, /every associated Pull Request/u);
  assert.match(codexWorkflow, /latest head of every[\s\S]*applicable Stemmio Pull Request/u);
  assert.match(releasing, /Mandatory installer delivery report/u);
  assert.match(releasing, /Default source set for a latest installer/u);
  assert.match(releasing, /Any selected unmerged Pull Request[\s\S]*Developer Preview/u);
  assert.match(playbook, /安装包内容报告/u);
  assert.match(playbook, /默认源码范围/u);
  assert.match(gitWorkflow, /Latest-installer source composition/u);
  assert.match(codexWorkflow, /最新 `origin\/main` \+ 当前开发范围/u);
  assert.match(development, /Package commands always build the exact current clean Tree/u);
});

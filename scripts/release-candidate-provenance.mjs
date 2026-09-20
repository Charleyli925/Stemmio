#!/usr/bin/env node

import { createHash } from "node:crypto";
import {
  appendFile,
  copyFile,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  agentProtocolReleaseSnapshot,
  assertAgentProtocolReleaseSnapshot,
  logAgentProtocolReleaseNotice,
} from "../shared/agent-protocol-acceptance.mjs";
import {
  assertBuildInfo,
  readRepositoryIdentity,
  SOURCE_REPOSITORY_URL,
} from "./release-provenance.mjs";
import { readPackageVersions } from "./source-gate-provenance.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const DEFAULT_MAX_AGE_HOURS = 72;
const DEFAULT_RETRIES = 3;

function assertSha(value, label) {
  if (!SHA_PATTERN.test(value || "")) throw new Error(`${label} must be a 40-character Git SHA.`);
  return value;
}

function assertVersion(value, label) {
  if (!VERSION_PATTERN.test(value || "")) throw new Error(`${label} must be a semantic version.`);
  return value;
}

function assertRepository(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value || "")) {
    throw new Error("repository must use the owner/name form.");
  }
  return value;
}

function assertArchitecture(value) {
  if (!/^(?:arm64|x64)$/u.test(value || "")) {
    throw new Error("architecture must be arm64 or x64.");
  }
  return value;
}

function assertPositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

export function releaseCandidateArtifactName(
  treeSha,
  packageVersion,
  architecture,
  runAttempt,
) {
  return [
    "Stemmio-release-candidate",
    assertSha(treeSha, "treeSha"),
    assertVersion(packageVersion, "packageVersion"),
    assertArchitecture(architecture),
    `attempt-${assertPositiveInteger(runAttempt, "run attempt")}`,
  ].join("-");
}

function expectedAssetNames(packageVersion, architecture) {
  const updateZip = `Stemmio-${packageVersion}-${architecture}.zip`;
  return [
    `Stemmio-${packageVersion}-${architecture}.dmg`,
    updateZip,
    `${updateZip}.blockmap`,
    "latest-mac.yml",
    "SHA256SUMS.txt",
    "build-info.json",
  ];
}

async function readLocalIdentity({ requireClean = true } = {}) {
  const [packageJson, packageLock] = await Promise.all([
    readFile(path.join(productRoot, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(productRoot, "package-lock.json"), "utf8").then(JSON.parse),
  ]);
  const versions = readPackageVersions(packageJson, packageLock);
  const repository = readRepositoryIdentity(productRoot);
  if (requireClean && repository.dirty) {
    throw new Error(
      `Release candidate provenance requires a clean checkout:\n${repository.dirtyPaths.join("\n")}`,
    );
  }
  return Object.freeze({
    ...repository,
    ...versions,
    packageJson,
  });
}

async function sha256(filePath) {
  const contents = await readFile(filePath);
  return `sha256:${createHash("sha256").update(contents).digest("hex")}`;
}

async function validateReleaseAssets({
  directory,
  identity,
  architecture,
}) {
  const expectedNames = expectedAssetNames(identity.packageVersion, architecture);
  const paths = Object.fromEntries(expectedNames.map((name) => [name, path.join(directory, name)]));
  const entries = await Promise.all(expectedNames.map(async (name) => {
    const info = await stat(paths[name]).catch(() => null);
    if (!info?.isFile()) throw new Error(`Release candidate asset is missing: ${name}`);
    return {
      name,
      sha256: await sha256(paths[name]),
      size: info.size,
    };
  }));
  const buildInfo = assertBuildInfo(
    JSON.parse(await readFile(paths["build-info.json"], "utf8")),
    {
      schemaVersion: 1,
      name: identity.packageJson.name,
      version: identity.packageVersion,
      architecture,
      sourceRepository: SOURCE_REPOSITORY_URL,
      commitSha: identity.commitSha,
      treeSha: identity.treeSha,
    },
  );
  const checksumText = await readFile(paths["SHA256SUMS.txt"], "utf8");
  const expectedChecksum = `${entries
    .filter((entry) => entry.name !== "SHA256SUMS.txt")
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => `${entry.sha256.slice("sha256:".length)}  ${entry.name}`)
    .join("\n")}\n`;
  if (checksumText !== expectedChecksum) {
    throw new Error("Release candidate checksums do not match the public asset bytes.");
  }
  return Object.freeze({
    entries: entries.map((entry) => Object.freeze(entry)),
    buildInfo,
  });
}

function managedBundleDirectory(value) {
  const resolved = path.resolve(productRoot, value);
  const managedRoot = path.join(productRoot, "output", "release-candidate");
  const relative = path.relative(managedRoot, resolved);
  if (
    relative === ""
    || relative.startsWith("..")
    || path.isAbsolute(relative)
  ) {
    throw new Error("Release candidate output must be a child of output/release-candidate.");
  }
  return resolved;
}

async function writeOutputs(destination, values) {
  if (!destination) return;
  const lines = Object.entries(values).map(([key, value]) => (
    `${key}=${String(value ?? "").replaceAll("\r", "").replaceAll("\n", "")}`
  ));
  await appendFile(destination, `${lines.join("\n")}\n`, "utf8");
}

async function createCandidate(options) {
  const identity = await readLocalIdentity();
  const architecture = assertArchitecture(options.architecture);
  const sourceGateTree = assertSha(options.sourceGateTree, "source gate tree");
  const sourceGateVersion = assertVersion(options.sourceGateVersion, "source gate version");
  if (
    sourceGateTree !== identity.treeSha
    || sourceGateVersion !== identity.packageVersion
  ) {
    throw new Error("Source-gate tree or version does not match the release candidate checkout.");
  }
  const workflowRunId = assertPositiveInteger(options.runId, "run id");
  const workflowRunAttempt = assertPositiveInteger(options.runAttempt, "run attempt");
  const sourceGateRunId = assertPositiveInteger(
    options.sourceGateRunId,
    "source gate run id",
  );
  const sourceDirectory = path.resolve(productRoot, options.directory);
  const validated = await validateReleaseAssets({
    directory: sourceDirectory,
    identity,
    architecture,
  });
  const outputDirectory = managedBundleDirectory(options.output);
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(validated.entries.map((entry) => (
    copyFile(
      path.join(sourceDirectory, entry.name),
      path.join(outputDirectory, entry.name),
    )
  )));
  for (const entry of validated.entries) {
    const copiedPath = path.join(outputDirectory, entry.name);
    const copiedInfo = await stat(copiedPath);
    if (copiedInfo.size !== entry.size || await sha256(copiedPath) !== entry.sha256) {
      throw new Error(`Release candidate changed while freezing ${entry.name}.`);
    }
  }
  const artifactName = releaseCandidateArtifactName(
    identity.treeSha,
    identity.packageVersion,
    architecture,
    workflowRunAttempt,
  );
  const agentProtocol = agentProtocolReleaseSnapshot({
    commitSha: identity.commitSha,
    packageVersion: identity.packageVersion,
    platform: `macos-${architecture}`,
  });
  const attestation = Object.freeze({
    schemaVersion: 1,
    repository: options.repository,
    event: "workflow_dispatch",
    architecture,
    candidateCommitSha: identity.commitSha,
    candidateTreeSha: identity.treeSha,
    packageVersion: identity.packageVersion,
    packageLockVersion: identity.lockVersion,
    sourceGate: {
      workflowRunId: sourceGateRunId,
      treeSha: sourceGateTree,
      packageVersion: sourceGateVersion,
    },
    workflowRunId,
    workflowRunAttempt,
    artifactName,
    createdAt: new Date().toISOString(),
    assets: validated.entries,
    agentProtocol,
  });
  const attestationPath = path.join(outputDirectory, "release-candidate.json");
  await writeFile(attestationPath, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
  await writeOutputs(options.githubOutput, {
    artifact_name: artifactName,
    bundle_path: outputDirectory,
    tree_sha: identity.treeSha,
    package_version: identity.packageVersion,
  });
  console.log(`Release candidate bundle: ${outputDirectory}`);
  console.log(`Release candidate artifact: ${artifactName}`);
  logAgentProtocolReleaseNotice(agentProtocol);
  return attestation;
}

export function evaluateReleaseCandidateEvidence({
  currentCommitSha,
  currentTreeSha,
  packageVersion,
  architecture = "arm64",
  workflowRuns,
  artifactsByRunId,
  now = new Date(),
  maxAgeHours = DEFAULT_MAX_AGE_HOURS,
}) {
  assertSha(currentCommitSha, "currentCommitSha");
  assertSha(currentTreeSha, "currentTreeSha");
  assertVersion(packageVersion, "packageVersion");
  assertArchitecture(architecture);
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error("maxAgeHours must be a positive number.");
  }
  const matchingRuns = (workflowRuns || [])
    .filter((run) => (
      run?.event === "workflow_dispatch"
      && run?.status === "completed"
      && run?.conclusion === "success"
      && run?.head_sha === currentCommitSha
      && run?.head_branch === "main"
    ))
    .sort((left, right) => (
      Date.parse(right.updated_at || right.created_at || "")
      - Date.parse(left.updated_at || left.created_at || "")
    ));
  if (matchingRuns.length === 0) {
    return Object.freeze({
      trusted: false,
      reason: "no_successful_candidate_run",
      runId: null,
    });
  }
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const freshRuns = matchingRuns.filter((run) => {
    const completedMs = Date.parse(run.updated_at || run.created_at || "");
    return Number.isFinite(completedMs)
      && completedMs <= nowMs
      && nowMs - completedMs <= maxAgeMs;
  });
  if (freshRuns.length === 0) {
    return Object.freeze({
      trusted: false,
      reason: "candidate_stale",
      runId: matchingRuns[0]?.id || null,
    });
  }
  for (const run of freshRuns) {
    const runAttempt = assertPositiveInteger(
      run.run_attempt || 1,
      "candidate run attempt",
    );
    const expectedName = releaseCandidateArtifactName(
      currentTreeSha,
      packageVersion,
      architecture,
      runAttempt,
    );
    const artifact = (artifactsByRunId?.[String(run.id)] || []).find((candidate) => (
      candidate?.name === expectedName && candidate?.expired !== true
    ));
    if (!artifact) continue;
    const completedMs = Date.parse(run.updated_at || run.created_at || "");
    return Object.freeze({
      trusted: true,
      reason: "matching_release_candidate",
      runId: run.id,
      runAttempt,
      artifactId: artifact.id,
      artifactName: artifact.name,
      ageHours: Math.round(((nowMs - completedMs) / (60 * 60 * 1000)) * 100) / 100,
    });
  }
  return Object.freeze({
    trusted: false,
    reason: "matching_candidate_artifact_missing",
    runId: freshRuns[0]?.id || null,
  });
}

async function githubJson(apiPath, token) {
  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  const response = await globalThis.fetch(`${apiBase}${apiPath}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GitHub API ${response.status} for ${apiPath}: ${body}`);
  }
  return await response.json();
}

async function collectRemoteEvidence(options, identity) {
  const token = process.env[options.tokenEnv] || "";
  if (!token) throw new Error(`Environment variable ${options.tokenEnv} is required.`);
  const repositoryPath = options.repository.split("/").map(encodeURIComponent).join("/");
  const workflow = encodeURIComponent(options.workflow);
  const response = await githubJson(
    `/repos/${repositoryPath}/actions/workflows/${workflow}/runs`
    + "?event=workflow_dispatch&status=success&branch=main&per_page=100",
    token,
  );
  const workflowRuns = response.workflow_runs || [];
  const matchingRuns = workflowRuns.filter((run) => run?.head_sha === identity.commitSha).slice(0, 10);
  const artifactsByRunId = {};
  await Promise.all(matchingRuns.map(async (run) => {
    const artifacts = await githubJson(
      `/repos/${repositoryPath}/actions/runs/${run.id}/artifacts?per_page=100`,
      token,
    );
    artifactsByRunId[String(run.id)] = artifacts.artifacts || [];
  }));
  return { workflowRuns, artifactsByRunId };
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function resolveCandidate(options) {
  const identity = await readLocalIdentity();
  let result = null;
  let error = null;
  for (let attempt = 1; attempt <= options.retries; attempt += 1) {
    try {
      const evidence = await collectRemoteEvidence(options, identity);
      result = evaluateReleaseCandidateEvidence({
        currentCommitSha: identity.commitSha,
        currentTreeSha: identity.treeSha,
        packageVersion: identity.packageVersion,
        architecture: options.architecture,
        ...evidence,
        maxAgeHours: options.maxAgeHours,
      });
      error = null;
      if (result.trusted || result.reason === "candidate_stale") break;
    } catch (caught) {
      error = caught;
    }
    if (attempt < options.retries) await delay(2 ** (attempt - 1) * 1000);
  }
  if (error) throw error;
  if (!result?.trusted) {
    throw new Error(`No reusable release candidate covers this exact tree: ${result?.reason}.`);
  }
  await writeOutputs(options.githubOutput, {
    trusted: true,
    reason: result.reason,
    run_id: result.runId,
    run_attempt: result.runAttempt,
    artifact_id: result.artifactId,
    artifact_name: result.artifactName,
    tree_sha: identity.treeSha,
    package_version: identity.packageVersion,
  });
  console.log(JSON.stringify({
    ...result,
    commitSha: identity.commitSha,
    treeSha: identity.treeSha,
    packageVersion: identity.packageVersion,
    maxAgeHours: options.maxAgeHours,
  }));
  return result;
}

function assertAttestationShape(attestation) {
  if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) {
    throw new Error("release-candidate.json must be an object.");
  }
  const allowedKeys = new Set([
    "schemaVersion",
    "repository",
    "event",
    "architecture",
    "candidateCommitSha",
    "candidateTreeSha",
    "packageVersion",
    "packageLockVersion",
    "sourceGate",
    "workflowRunId",
    "workflowRunAttempt",
    "artifactName",
    "createdAt",
    "assets",
    "agentProtocol",
  ]);
  if (Object.keys(attestation).some((key) => !allowedKeys.has(key))) {
    throw new Error("release-candidate.json contains unsupported fields.");
  }
  return attestation;
}

export async function verifyReleaseCandidateBundle({
  directory,
  identity,
  architecture,
  repository,
  runId,
  runAttempt,
}) {
  const normalizedArchitecture = assertArchitecture(architecture);
  const expectedRunId = assertPositiveInteger(runId, "run id");
  const expectedRunAttempt = assertPositiveInteger(runAttempt, "run attempt");
  const resolvedDirectory = path.resolve(directory);
  const attestation = assertAttestationShape(
    JSON.parse(
      await readFile(path.join(resolvedDirectory, "release-candidate.json"), "utf8"),
    ),
  );
  const expectedArtifactName = releaseCandidateArtifactName(
    identity.treeSha,
    identity.packageVersion,
    normalizedArchitecture,
    expectedRunAttempt,
  );
  const expectedTopLevel = {
    schemaVersion: 1,
    repository: assertRepository(repository),
    event: "workflow_dispatch",
    architecture: normalizedArchitecture,
    candidateCommitSha: identity.commitSha,
    candidateTreeSha: identity.treeSha,
    packageVersion: identity.packageVersion,
    packageLockVersion: identity.lockVersion,
    workflowRunId: expectedRunId,
    workflowRunAttempt: expectedRunAttempt,
    artifactName: expectedArtifactName,
  };
  for (const [key, expected] of Object.entries(expectedTopLevel)) {
    if (attestation[key] !== expected) {
      throw new Error(`Release candidate provenance mismatch for ${key}.`);
    }
  }
  assertPositiveInteger(attestation.workflowRunAttempt, "attested run attempt");
  if (
    !attestation.sourceGate
    || Object.keys(attestation.sourceGate).some((key) => (
      !["workflowRunId", "treeSha", "packageVersion"].includes(key)
    ))
    || attestation.sourceGate.treeSha !== identity.treeSha
    || attestation.sourceGate.packageVersion !== identity.packageVersion
  ) {
    throw new Error("Release candidate source-gate identity does not match the checkout.");
  }
  assertPositiveInteger(attestation.sourceGate.workflowRunId, "source-gate run id");
  assertAgentProtocolReleaseSnapshot(attestation.agentProtocol, {
    commitSha: identity.commitSha,
    packageVersion: identity.packageVersion,
    platform: `macos-${normalizedArchitecture}`,
  });
  if (!Number.isFinite(Date.parse(attestation.createdAt || ""))) {
    throw new Error("Release candidate createdAt is invalid.");
  }
  const expectedNames = expectedAssetNames(identity.packageVersion, architecture);
  if (
    !Array.isArray(attestation.assets)
    || attestation.assets.length !== expectedNames.length
    || new Set(attestation.assets.map((entry) => entry?.name)).size !== expectedNames.length
  ) {
    throw new Error("Release candidate asset manifest has an unexpected shape.");
  }
  for (const expectedName of expectedNames) {
    const entry = attestation.assets.find((candidate) => candidate?.name === expectedName);
    if (
      !entry
      || Object.keys(entry).some((key) => !["name", "sha256", "size"].includes(key))
      || !/^sha256:[0-9a-f]{64}$/u.test(entry.sha256 || "")
      || !Number.isSafeInteger(entry.size)
      || entry.size < 0
    ) {
      throw new Error(`Release candidate asset manifest is invalid for ${expectedName}.`);
    }
    const filePath = path.join(resolvedDirectory, expectedName);
    const info = await stat(filePath).catch(() => null);
    if (
      !info?.isFile()
      || info.size !== entry.size
      || await sha256(filePath) !== entry.sha256
    ) {
      throw new Error(`Release candidate asset bytes do not match for ${expectedName}.`);
    }
  }
  await validateReleaseAssets({
    directory: resolvedDirectory,
    identity,
    architecture: normalizedArchitecture,
  });
  console.log(`Verified release candidate ${expectedArtifactName} from run ${expectedRunId}.`);
  return attestation;
}

async function verifyCandidate(options) {
  const identity = await readLocalIdentity();
  return verifyReleaseCandidateBundle({
    directory: path.resolve(productRoot, options.directory),
    identity,
    architecture: options.architecture,
    repository: options.repository,
    runId: options.runId,
    runAttempt: options.runAttempt,
  });
}

function parseOptions(argv) {
  const command = argv.shift();
  if (!/^(?:create|resolve|verify)$/u.test(command || "")) {
    throw new Error(
      "Usage: release-candidate-provenance.mjs <create|resolve|verify> [options]",
    );
  }
  const options = {
    command,
    repository: process.env.GITHUB_REPOSITORY || "",
    architecture: "arm64",
    directory: command === "create" ? "release" : "output/downloaded-release-candidate",
    output: "output/release-candidate/bundle",
    githubOutput: process.env.GITHUB_OUTPUT || "",
    workflow: "release-candidate.yml",
    tokenEnv: "GITHUB_TOKEN",
    maxAgeHours: DEFAULT_MAX_AGE_HOURS,
    retries: DEFAULT_RETRIES,
    runId: process.env.GITHUB_RUN_ID || "",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || "",
    sourceGateRunId: "",
    sourceGateTree: "",
    sourceGateVersion: "",
  };
  while (argv.length > 0) {
    const argument = argv.shift();
    const value = argv.shift();
    if (!value) throw new Error(`${argument} requires a value.`);
    if (argument === "--repository") options.repository = value;
    else if (argument === "--architecture") options.architecture = value;
    else if (argument === "--directory") options.directory = value;
    else if (argument === "--output") options.output = value;
    else if (argument === "--github-output") options.githubOutput = value;
    else if (argument === "--workflow") options.workflow = value;
    else if (argument === "--token-env") options.tokenEnv = value;
    else if (argument === "--max-age-hours") options.maxAgeHours = Number(value);
    else if (argument === "--retries") options.retries = Number(value);
    else if (argument === "--run-id") options.runId = value;
    else if (argument === "--run-attempt") options.runAttempt = value;
    else if (argument === "--source-gate-run-id") options.sourceGateRunId = value;
    else if (argument === "--source-gate-tree") options.sourceGateTree = value;
    else if (argument === "--source-gate-version") options.sourceGateVersion = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  assertRepository(options.repository);
  assertArchitecture(options.architecture);
  if (!Number.isFinite(options.maxAgeHours) || options.maxAgeHours <= 0) {
    throw new Error("--max-age-hours must be a positive number.");
  }
  if (!Number.isInteger(options.retries) || options.retries < 1 || options.retries > 5) {
    throw new Error("--retries must be an integer from 1 to 5.");
  }
  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.command === "create") await createCandidate(options);
  else if (options.command === "resolve") await resolveCandidate(options);
  else await verifyCandidate(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}

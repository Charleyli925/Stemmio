// Thin public entry for the reviewed A/B/C real-HTML scenario family.
// Listing and plan validation are read-only. Execution only dispatches the
// existing frozen executors; it never discovers or substitutes a target.
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createFrozenScenarioLedger,
  listFrozenScenarioDefinitions,
  parseFrozenEntryArgs,
  readFrozenScenarioPlanFile,
  recordFrozenScenarioOutcome,
  summarizeFrozenScenarioLedger,
  summarizeFrozenScenarioReport,
  validateNestedFrozenScenarioPlans,
} from "./real-html/frozen-entry-contract.mjs";
import { workspaceSourceFingerprint } from "./real-html/workspace-provenance.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const electronDirectory = path.dirname(scriptPath);
const productRoot = path.resolve(electronDirectory, "../..");
const DEFAULT_RENDERER_BUILD_TIMEOUT_MS = 180_000;
const DEFAULT_SCENARIO_TIMEOUT_MS = 15 * 60_000;
const PROCESS_TERM_GRACE_MS = 1_000;
const PROCESS_KILL_WAIT_MS = 2_000;
const PROCESS_POLL_MS = 25;
const MAX_OUTPUT_SUMMARY_BYTES = 32 * 1024;

export function preflightReportDirectoryFromOutput(stdout) {
  const matches = [...String(stdout || "").matchAll(/^Private report: (.+)$/gmu)];
  if (matches.length !== 1 || !path.isAbsolute(matches[0][1])) {
    throw Object.assign(new Error("The isolated capability preflight did not publish one absolute report directory."), {
      code: "FROZEN_ENTRY_PREFLIGHT_REPORT_PATH_INVALID",
    });
  }
  return path.resolve(matches[0][1]);
}

export function aggregateCapabilityPreflightReports(childReports, expectedFiles) {
  if (!Array.isArray(childReports) || childReports.length === 0) {
    throw Object.assign(new Error("Capability preflight aggregation requires at least one child report."), {
      code: "FROZEN_ENTRY_PREFLIGHT_REPORTS_MISSING",
    });
  }
  if (!Array.isArray(expectedFiles) || expectedFiles.length !== childReports.length) {
    throw Object.assign(new Error("Capability preflight reports must match the parent file plan."), {
      code: "FROZEN_ENTRY_PREFLIGHT_PARENT_PLAN_INVALID",
    });
  }
  const first = childReports[0];
  const provenanceFields = ["head", "tree", "workspaceSourceSha256", "untrackedSourceFileCount"];
  const seenFileIds = new Set();
  const seenSelectedIndexes = new Set();
  for (const [index, report] of childReports.entries()) {
    const expected = expectedFiles[index];
    if (!report || report.mode !== "capability-preflight-only" || report.results?.length !== 1) {
      throw Object.assign(new Error("An isolated capability preflight report has an invalid shape."), {
        code: "FROZEN_ENTRY_PREFLIGHT_REPORT_INVALID",
        details: { index: index + 1 },
      });
    }
    for (const field of provenanceFields) {
      if (report[field] !== first[field]) {
        throw Object.assign(new Error("Isolated capability preflight source provenance drifted between files."), {
          code: "FROZEN_ENTRY_PREFLIGHT_PROVENANCE_MISMATCH",
          details: { index: index + 1, field },
        });
      }
    }
    const row = report.results[0];
    const selectedFileIndexes = report.selectedFileIndexes;
    const selectedFileIndex = Array.isArray(selectedFileIndexes)
      ? selectedFileIndexes[0]
      : null;
    if (seenFileIds.has(row.fileId) || seenSelectedIndexes.has(selectedFileIndex)) {
      throw Object.assign(new Error("The isolated capability preflight repeats a parent file plan entry."), {
        code: "FROZEN_ENTRY_PREFLIGHT_FILE_DUPLICATE",
        details: { index: index + 1, fileId: row.fileId },
      });
    }
    const bindingMatches = report.planned === 1
      && report.corpusFiles === expectedFiles.length
      && Array.isArray(selectedFileIndexes)
      && selectedFileIndexes.length === 1
      && selectedFileIndex === expected.selectedFileIndex
      && row.fileId === expected.fileId
      && row.originalSha256 === expected.originalSha256
      && row.originalSize === expected.originalSize;
    if (!bindingMatches) {
      throw Object.assign(new Error("An isolated capability preflight report does not match its parent file plan."), {
        code: "FROZEN_ENTRY_PREFLIGHT_FILE_BINDING_MISMATCH",
        details: { index: index + 1, expectedFileId: expected.fileId },
      });
    }
    seenFileIds.add(row.fileId);
    seenSelectedIndexes.add(selectedFileIndex);
    const actualSeed = row.preflightWorkingCopy?.frozenSeed;
    const expectedSeed = expected.frozenSeed;
    if (expectedSeed) {
      const seedMatches = row.preflightWorkingCopy?.unchanged === true
        && actualSeed?.relativePath === expectedSeed.relativePath
        && actualSeed?.sha256 === expectedSeed.sha256
        && actualSeed?.size === expectedSeed.size
        && actualSeed?.exactManagedCopy === true
        && row.preflightWorkingCopy.beforeSha256 === expectedSeed.sha256
        && row.preflightWorkingCopy.afterSha256 === expectedSeed.sha256
        && row.preflightWorkingCopy.beforeSize === expectedSeed.size
        && row.preflightWorkingCopy.afterSize === expectedSeed.size;
      if (!seedMatches) {
        throw Object.assign(new Error("An isolated frozen seed does not match the parent-observed managed copy."), {
          code: "FROZEN_ENTRY_PREFLIGHT_SEED_BINDING_MISMATCH",
          details: { index: index + 1, fileId: row.fileId },
        });
      }
    } else if (actualSeed) {
      throw Object.assign(new Error("An isolated child reported a frozen seed absent from the parent plan."), {
        code: "FROZEN_ENTRY_PREFLIGHT_SEED_BINDING_MISMATCH",
        details: { index: index + 1, fileId: row.fileId },
      });
    }
  }
  const results = childReports.map((report) => report.results[0]);
  const aggregate = {
    ...first,
    planned: results.length,
    corpusFiles: results.length,
    selectedFileIndexes: expectedFiles.map((file) => file.selectedFileIndex),
    results,
    pendingReview: results.filter((row) => row.status === "PENDING_REVIEW").length,
    discoveryErrors: results.filter((row) => row.status === "DISCOVERY_ERROR").length,
    environmentBlocked: results.filter((row) => row.status === "ENVIRONMENT_BLOCKED").length,
    originalsUnchanged: results.every((row) => row.originalUnchanged === true),
  };
  aggregate.draftFingerprint = createHash("sha256").update(Buffer.from(JSON.stringify({
    head: aggregate.head,
    tree: aggregate.tree,
    workspaceSourceSha256: aggregate.workspaceSourceSha256,
    files: results.map((row, index) => ({
      fileId: row.fileId,
      originalSha256: row.originalSha256,
      originalSize: row.originalSize,
      originalUnchanged: row.originalUnchanged,
      selectedFileIndex: aggregate.selectedFileIndexes[index],
      frozenSeed: row.preflightWorkingCopy?.frozenSeed || null,
      manifestFingerprint: row.capabilityManifest?.fingerprint || null,
      draft: row.capabilityManifest?.draft || null,
    })),
  }))).digest("hex");
  return aggregate;
}

async function runIsolatedCapabilityPreflight() {
  const corpus = process.env.STEMMIO_REAL_HTML_DIR;
  const corpusFiles = readdirSync(corpus).filter((name) => /\.html?$/iu.test(name)).sort();
  if (corpusFiles.length === 0) {
    throw Object.assign(new Error("The local corpus contains no HTML files."), {
      code: "FROZEN_ENTRY_CORPUS_EMPTY",
    });
  }
  const aggregateDirectory = mkdtempSync(path.join(tmpdir(), "stemmio-real-html-acceptance-"));
  process.stdout.write(`Private report: ${aggregateDirectory}\n`);
  const reports = [];
  const reportDirectories = [];
  const expectedFiles = corpusFiles.map((name, index) => {
    const original = readFileSync(path.join(corpus, name));
    return {
      childIndex: index,
      selectedFileIndex: index + 1,
      fileId: `H${String(index + 1).padStart(2, "0")}`,
      originalSha256: createHash("sha256").update(original).digest("hex"),
      originalSize: original.length,
      frozenSeedRelativePath: `${index}/frozen-managed-seed.html`,
      frozenSeed: null,
    };
  });
  let childFailure = false;
  for (let index = 0; index < corpusFiles.length; index += 1) {
    const child = await runCommand(
      process.execPath,
      [path.join(electronDirectory, "local-html-corpus.mjs")],
      {
        env: {
          ...process.env,
          STEMMIO_REAL_HTML_MODE: "capability-preflight-only",
          STEMMIO_REAL_HTML_FILE_INDEXES: String(index + 1),
        },
        outputDirectory: path.join(aggregateDirectory, "children", String(index)),
        printOutput: false,
      },
    );
    if (child.spawnError || child.timedOut || child.cleanup?.confirmed !== true) {
      childFailure = true;
    }
    const reportDirectory = preflightReportDirectoryFromOutput(child.stdout);
    const childReport = JSON.parse(readFileSync(path.join(reportDirectory, "results.json"), "utf8"));
    reports.push(childReport);
    reportDirectories.push(reportDirectory);
    const seedRelativePath = expectedFiles[index].frozenSeedRelativePath;
    const seedPath = path.resolve(reportDirectory, seedRelativePath);
    const reportRoot = `${path.resolve(reportDirectory)}${path.sep}`;
    if (!seedPath.startsWith(reportRoot)) {
      throw Object.assign(new Error("An isolated frozen seed escaped its report directory."), {
        code: "FROZEN_ENTRY_PREFLIGHT_SEED_PATH_INVALID",
        details: { index: index + 1 },
      });
    }
    if (existsSync(seedPath)) {
      const seed = readFileSync(seedPath);
      expectedFiles[index].frozenSeed = {
        relativePath: seedRelativePath,
        sha256: createHash("sha256").update(seed).digest("hex"),
        size: seed.length,
      };
    }
    const row = childReport.results?.[0];
    const firstFailure = row?.discovery?.firstFailure;
    const suffix = firstFailure ? ` firstFailure=${firstFailure.stage}/${firstFailure.code}` : "";
    process.stdout.write(
      `${index + 1}/${corpusFiles.length}: ${row?.status || "ENVIRONMENT_BLOCKED"} capability preflight${suffix}\n`,
    );
    if (child.exitCode !== 0) childFailure = true;
  }
  const aggregate = aggregateCapabilityPreflightReports(reports, expectedFiles);
  for (let index = 0; index < aggregate.results.length; index += 1) {
    const row = aggregate.results[index];
    const relativeSeed = row.preflightWorkingCopy?.frozenSeed?.relativePath;
    if (typeof relativeSeed !== "string" || path.isAbsolute(relativeSeed)) continue;
    const source = path.resolve(reportDirectories[index], relativeSeed);
    const sourceRoot = `${path.resolve(reportDirectories[index])}${path.sep}`;
    if (!source.startsWith(sourceRoot)) {
      throw Object.assign(new Error("An isolated frozen seed escaped its report directory."), {
        code: "FROZEN_ENTRY_PREFLIGHT_SEED_PATH_INVALID",
        details: { index: index + 1 },
      });
    }
    const destination = path.resolve(aggregateDirectory, relativeSeed);
    const destinationRoot = `${path.resolve(aggregateDirectory)}${path.sep}`;
    if (!destination.startsWith(destinationRoot)) {
      throw Object.assign(new Error("An aggregate frozen seed escaped its report directory."), {
        code: "FROZEN_ENTRY_PREFLIGHT_SEED_PATH_INVALID",
        details: { index: index + 1 },
      });
    }
    mkdirSync(path.dirname(destination), { recursive: true });
    copyFileSync(source, destination);
  }
  writeFileSync(
    path.join(aggregateDirectory, "results.json"),
    JSON.stringify(aggregate, null, 2),
  );
  return childFailure
    || aggregate.pendingReview !== corpusFiles.length
    || aggregate.originalsUnchanged !== true
    ? 1
    : 0;
}

function reportError(error) {
  return {
    state: "FAIL",
    code: error?.code || error?.name || "FROZEN_ENTRY_FAILED",
    message: error?.message || String(error),
  };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function processGroupAlive(child) {
  if (!child?.pid) return false;
  try {
    process.kill(process.platform === "win32" ? child.pid : -child.pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function signalProcessTree(child, signal) {
  if (!child?.pid) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, signal); } catch { /* The process group may already be gone. */ }
  }
  try { child.kill(signal); } catch { /* The process may already be gone. */ }
}

async function waitForProcessGroupExit(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupAlive(child) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, PROCESS_POLL_MS));
  }
  return !processGroupAlive(child);
}

/**
 * Terminate only the process group owned by this invocation and verify that it
 * is gone. A parent close event is not sufficient: descendants can outlive it.
 */
async function terminateProcessTree(child) {
  if (!child?.pid || !processGroupAlive(child)) {
    return { attempted: false, confirmed: true, signal: null };
  }
  signalProcessTree(child, "SIGTERM");
  if (await waitForProcessGroupExit(child, PROCESS_TERM_GRACE_MS)) {
    return { attempted: true, confirmed: true, signal: "SIGTERM" };
  }
  signalProcessTree(child, "SIGKILL");
  const confirmed = await waitForProcessGroupExit(child, PROCESS_KILL_WAIT_MS);
  return { attempted: true, confirmed, signal: "SIGKILL" };
}

function appendOutputSummary(previous, chunk) {
  const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk);
  return `${previous}${text}`.slice(-MAX_OUTPUT_SUMMARY_BYTES);
}

function closeOutputStream(stream, existingError = null) {
  if (!stream) return Promise.resolve(null);
  return new Promise((resolve) => {
    let error = existingError;
    const onError = (cause) => {
      error ||= { code: cause.code || "OUTPUT_LOG_FAILED", message: cause.message };
    };
    stream.once("error", onError);
    stream.end(() => resolve(error));
  });
}

/** Run a bounded child process, retain bounded output and verify owned cleanup. */
export function runCommand(command, args, {
  env = process.env,
  timeoutMs = DEFAULT_SCENARIO_TIMEOUT_MS,
  outputDirectory = null,
  printOutput = true,
} = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let spawnError = null;
    let timedOut = false;
    let settled = false;
    let closed = false;
    let closeStatus = null;
    let closeSignal = null;
    let cleanup = { attempted: false, confirmed: true, signal: null };
    let cleanupPromise = null;
    let finishing = false;
    const logDirectory = outputDirectory ? path.resolve(outputDirectory) : null;
    if (logDirectory) mkdirSync(logDirectory, { recursive: true });
    const stdoutPath = logDirectory ? path.join(logDirectory, "child.stdout.log") : null;
    const stderrPath = logDirectory ? path.join(logDirectory, "child.stderr.log") : null;
    const stdoutLog = stdoutPath ? createWriteStream(stdoutPath, { flags: "w" }) : null;
    const stderrLog = stderrPath ? createWriteStream(stderrPath, { flags: "w" }) : null;
    let stdoutLogError = null;
    let stderrLogError = null;
    stdoutLog?.on("error", (cause) => {
      stdoutLogError ||= { code: cause.code || "OUTPUT_LOG_FAILED", message: cause.message };
    });
    stderrLog?.on("error", (cause) => {
      stderrLogError ||= { code: cause.code || "OUTPUT_LOG_FAILED", message: cause.message };
    });
    const child = spawn(command, args, {
      cwd: productRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const startCleanup = () => {
      if (!cleanupPromise) {
        cleanupPromise = terminateProcessTree(child);
        cleanupPromise.then((result) => {
          cleanup = result;
          // A killed process normally emits `close` immediately. Keep the
          // runner bounded even if Node delays that event after the owned
          // process group has already been confirmed gone.
          if (timedOut && !closed) {
            closed = true;
            closeStatus = null;
            closeSignal = result.signal || "SIGKILL";
          }
          maybeFinish();
        });
      }
      return cleanupPromise;
    };
    const timer = setTimeout(() => {
      timedOut = true;
      startCleanup();
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout = appendOutputSummary(stdout, chunk);
      stdoutLog?.write(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr = appendOutputSummary(stderr, chunk);
      stderrLog?.write(chunk);
    });
    const finish = async () => {
      if (settled || finishing || !closed) return;
      finishing = true;
      try {
        await startCleanup();
        settled = true;
        clearTimeout(timer);
        const [closedStdoutError, closedStderrError] = await Promise.all([
          closeOutputStream(stdoutLog, stdoutLogError), closeOutputStream(stderrLog, stderrLogError),
        ]);
        if (printOutput && stdout) process.stdout.write(stdout);
        if (printOutput && stderr) process.stderr.write(stderr);
        resolve({
          exitCode: Number.isInteger(closeStatus) ? closeStatus : null,
          signal: closeSignal || null,
          timedOut,
          spawnError,
          stdout,
          stderr,
          stdoutPath,
          stderrPath,
          cleanup: { ...cleanup, outputLogErrors: [closedStdoutError, closedStderrError].filter(Boolean) },
        });
      } finally {
        finishing = false;
      }
    };
    function maybeFinish() { void finish(); }
    child.once("error", (error) => {
      spawnError = { code: error.code || "SPAWN_ERROR", message: error.message };
      if (!child.pid) {
        closed = true;
        closeStatus = null;
        closeSignal = null;
        startCleanup();
        maybeFinish();
      }
    });
    child.once("close", (status, signal) => {
      closed = true;
      closeStatus = status;
      closeSignal = signal;
      startCleanup();
      maybeFinish();
    });
  });
}

export async function ensureRendererBuilt({ run = runCommand } = {}) {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath
    ? process.execPath
    : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = npmExecPath
    ? [npmExecPath, "run", "desktop:renderer"]
    : ["run", "desktop:renderer"];
  const result = await run(command, args, {
    env: process.env,
    timeoutMs: DEFAULT_RENDERER_BUILD_TIMEOUT_MS,
  });
  if (result.spawnError || result.timedOut || result.exitCode !== 0 || result.cleanup?.confirmed !== true) {
    throw Object.assign(new Error("The desktop renderer build failed before frozen execution."), {
      code: "FROZEN_ENTRY_RENDERER_BUILD_FAILED",
      details: result,
    });
  }
  return result;
}

function planSummary(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    kind: plan.kind,
    reviewStatus: plan.reviewStatus,
    digest: plan.digest,
    version: plan.version,
    scenarios: plan.scenarios.map((scenario, index) => ({
      order: index + 1,
      id: scenario.id,
      label: scenario.label || plan.definitions[index].label,
      purpose: scenario.purpose,
      runner: scenario.runner,
      scope: scenario.scope,
      manifestFile: path.basename(scenario.manifestPath),
      manifestSha256: scenario.manifestSha256,
      requiredFacts: plan.definitions[index].requiredFacts,
    })),
  };
}

function scenarioChild(scenario) {
  const moduleName = scenario.runner === "frozen-html-operation"
    ? "frozen-html-operation.mjs"
    : null;
  if (!moduleName) throw Object.assign(new Error(`Unsupported runner ${scenario.runner}.`), {
    code: "FROZEN_ENTRY_SCENARIO_RUNNER_INVALID",
  });
  return path.join(electronDirectory, moduleName);
}

function childEnvironment(scenario, { reportPath, reportDirectory, nestedPlan } = {}) {
  const env = { ...process.env, STEMMIO_FROZEN_SCENARIO_ID: scenario.id };
  // C uses an accepted same-parent move with one injected post-acceptance
  // projection failure.  No process-wide structural switch may broaden the
  // direct product surface or turn a rejected operation into a Candidate.
  delete env.STEMMIO_DISABLE_STRUCTURAL_IN_PLACE;
  if (scenario.id === "C"
    && nestedPlan?.targets?.[0]?.rebuildTrigger === "accepted-projection-failure") {
    env.STEMMIO_E2E_RUNTIME_COMMIT_HOOKS = "1";
  } else {
    delete env.STEMMIO_E2E_RUNTIME_COMMIT_HOOKS;
  }
  if (!env.STEMMIO_E2E_WINDOW_MODE && env.STEMMIO_E2E_FOREGROUND !== "1") {
    // Real-HTML local runs should be inspectable without activating Stemmio.
    env.STEMMIO_E2E_WINDOW_MODE = "visible-background";
  }
  if (scenario.runner === "frozen-html-operation") {
    env.STEMMIO_FROZEN_MANIFEST = scenario.manifestPath;
    env.STEMMIO_FROZEN_MANIFEST_SHA256 = scenario.manifestSha256;
    env.STEMMIO_FROZEN_REPORT_PATH = reportPath;
    env.STEMMIO_FROZEN_REPORT_DIRECTORY = reportDirectory;
    env.STEMMIO_FROZEN_SCENARIO_SCOPE = scenario.scope;
    env.STEMMIO_FROZEN_EXPECTED_OPERATIONS = JSON.stringify(
      nestedPlan?.targets?.[0]?.operations || [],
    );
    env.STEMMIO_FROZEN_REQUIRED_REBUILD_OPERATION = nestedPlan?.targets?.[0]
      ?.projectionByOperation?.["move-copy"] || "";
  }
  return env;
}

function childProcessSummary(child) {
  return {
    exitCode: child?.exitCode ?? null,
    signal: child?.signal || null,
    timedOut: child?.timedOut === true,
    spawnError: child?.spawnError || null,
    stdoutPath: child?.stdoutPath || null,
    stderrPath: child?.stderrPath || null,
    stdoutTail: child?.stdout || "",
    stderrTail: child?.stderr || "",
    cleanup: child?.cleanup || null,
  };
}

function nestedPlanSummary(nestedPlan = {}) {
  return {
    scope: nestedPlan.scope || null,
    operation: nestedPlan.operation || null,
    initialRuntime: nestedPlan.initialRuntime || null,
    reopen: nestedPlan.reopen === true,
    cycles: Number.isSafeInteger(nestedPlan.cycles) ? nestedPlan.cycles : null,
    operations: Array.isArray(nestedPlan.targets?.[0]?.operations)
      ? nestedPlan.targets[0].operations
      : [],
    expectedRebuild: nestedPlan.targets?.[0]?.projectionByOperation?.["move-copy"] || null,
    rebuildPath: nestedPlan.targets?.[0]?.rebuildPath || null,
  };
}

function readChildReport(reportPath) {
  if (!existsSync(reportPath)) return { report: null, error: { code: "FROZEN_ENTRY_CHILD_REPORT_MISSING" } };
  try {
    return { report: JSON.parse(readFileSync(reportPath, "utf8")), error: null };
  } catch (error) {
    return { report: null, error: reportError(Object.assign(error, { code: "FROZEN_ENTRY_CHILD_REPORT_JSON_INVALID" })) };
  }
}

export async function executePlan(plan, currentVersion, nestedPlans = [], {
  build = ensureRendererBuilt,
  run = runCommand,
  scenarioTimeoutMs = DEFAULT_SCENARIO_TIMEOUT_MS,
  print = true,
} = {}) {
  const output = mkdtempSync(path.join(tmpdir(), "stemmio-frozen-scenarios-"));
  const ledgerStart = createFrozenScenarioLedger(plan);
  const report = {
    schemaVersion: 1,
    kind: "stemmio-frozen-scenario-run",
    source: currentVersion,
    plan: planSummary(plan),
    reportDirectory: output,
    ledger: ledgerStart,
    scenarioReports: [],
    state: "NOT_EXECUTED",
  };
  const writeReport = () => writeFileSync(
    path.join(output, "scenario-results.json"),
    `${JSON.stringify({ ...report, summary: summarizeFrozenScenarioLedger(report.ledger) }, null, 2)}\n`,
  );
  writeReport();

  try {
    await build();
  } catch (error) {
    for (const [index, scenario] of plan.scenarios.entries()) {
      const scenarioDirectory = path.join(output, scenario.id);
      mkdirSync(scenarioDirectory, { recursive: true });
      const reportPath = path.join(scenarioDirectory, "result.json");
      const failure = reportError(error);
      const scenarioReport = {
        order: index + 1,
        id: scenario.id,
        scope: scenario.scope,
        manifestSha256: scenario.manifestSha256,
        nestedPlan: nestedPlanSummary(nestedPlans[index]),
        reportPath,
        process: null,
        evidence: null,
        firstFailure: failure,
      };
      report.scenarioReports.push(scenarioReport);
      report.ledger = recordFrozenScenarioOutcome(report.ledger, scenario.id, {
        state: "NOT_EXECUTED",
        reason: "ENVIRONMENT_BLOCKED",
        details: scenarioReport,
      });
    }
    report.state = "NOT_EXECUTED";
    report.firstFailure = reportError(error);
    report.summary = summarizeFrozenScenarioLedger(report.ledger);
    writeReport();
    if (print) printJson(report);
    return { exitCode: 1, reportDirectory: output, report };
  }

  for (const [index, scenario] of plan.scenarios.entries()) {
    const scenarioDirectory = path.join(output, scenario.id);
    mkdirSync(scenarioDirectory, { recursive: true });
    const reportPath = path.join(scenarioDirectory, "result.json");
    const nestedPlan = nestedPlans[index] || {};
    let child = null;
    let childReport = null;
    let childReportReadError = null;
    let evidence = null;
    let protocolError = null;
    try {
      child = await run(process.execPath, [scenarioChild(scenario)], {
        env: childEnvironment(scenario, { reportPath, reportDirectory: scenarioDirectory, nestedPlan }),
        timeoutMs: scenarioTimeoutMs,
        outputDirectory: scenarioDirectory,
      });
    } catch (error) {
      child = { exitCode: null, signal: null, timedOut: false,
        spawnError: reportError(Object.assign(error, { code: "FROZEN_ENTRY_CHILD_SPAWN_FAILED" })) };
    }
    ({ report: childReport, error: childReportReadError } = readChildReport(reportPath));
    if (childReport && !childReportReadError) {
      try {
        if (childReport.reportPath !== reportPath || childReport.reportDirectory !== scenarioDirectory) {
          throw Object.assign(new Error("Child report path is not bound to this scenario invocation."), {
            code: "FROZEN_ENTRY_CHILD_REPORT_PATH_INVALID",
            details: {
              expectedPath: reportPath,
              actualPath: childReport.reportPath,
              expectedDirectory: scenarioDirectory,
              actualDirectory: childReport.reportDirectory,
            },
          });
        }
        evidence = summarizeFrozenScenarioReport(childReport, scenario, nestedPlan, currentVersion);
      } catch (error) {
        protocolError = reportError(error);
      }
    }
    // A timeout may have left descendants alive even after the child reports
    // itself closed. Never advance to another scenario without an explicit
    // process-group cleanup confirmation for that path.
    // Every spawned child owns an isolated process group. A missing cleanup
    // receipt is unknown state, not a successful no-op: allowing the next
    // scenario to start would invalidate the isolation guarantee. Spawn
    // failures are the only path without a child process to clean up.
    const cleanupRequired = Boolean(child) && !child.spawnError;
    const cleanupUnconfirmed = cleanupRequired && child.cleanup?.confirmed !== true;
    let state = "FAIL";
    let reason = "CHILD_REPORT_PROTOCOL_FAILED";
    if (child?.spawnError) {
      state = "NOT_EXECUTED";
      reason = "CHILD_SPAWN_FAILED";
    } else if (child?.timedOut) {
      reason = "CHILD_TIMEOUT";
    } else if (childReportReadError) {
      reason = childReportReadError.code === "FROZEN_ENTRY_CHILD_REPORT_MISSING"
        ? "CHILD_REPORT_MISSING" : "CHILD_REPORT_INVALID";
    } else if (protocolError) {
      reason = "CHILD_REPORT_PROTOCOL_FAILED";
    } else if (childReport?.state === "NOT_EXECUTED") {
      state = "NOT_EXECUTED";
      reason = "CHILD_REPORT_NOT_EXECUTED";
    } else if (childReport?.state === "PASS" && child?.exitCode === 0) {
      state = "PASS";
      reason = "SCENARIO_COMPLETED";
    } else if (childReport?.state === "FAIL") {
      reason = "CHILD_REPORT_FAILED";
    } else if (child?.exitCode !== 0) {
      reason = `CHILD_EXIT_${child?.exitCode ?? "UNKNOWN"}`;
    }
    if (cleanupUnconfirmed) {
      state = "NOT_EXECUTED";
      reason = "ENVIRONMENT_BLOCKED";
    }
    const scenarioReport = {
      order: index + 1,
      id: scenario.id,
      scope: scenario.scope,
      manifestSha256: scenario.manifestSha256,
      nestedPlan: nestedPlanSummary(nestedPlan),
      reportPath,
      process: childProcessSummary(child),
      evidence,
      firstFailure: cleanupUnconfirmed
        ? { code: "FROZEN_ENTRY_PROCESS_CLEANUP_UNCONFIRMED", cleanup: child.cleanup }
        : child?.timedOut
          ? { code: "CHILD_TIMEOUT" }
        : child?.spawnError
          ? child.spawnError
          : childReport?.firstFailure || protocolError || childReportReadError || null,
    };
    report.scenarioReports.push(scenarioReport);
    report.ledger = recordFrozenScenarioOutcome(report.ledger, scenario.id, {
      state,
      reason,
      details: scenarioReport,
    });
    // A scenario failure is retained, but never causes an implicit retry or
    // prevents the independent later scenario from producing its own facts.
    writeReport();
    if (cleanupUnconfirmed) {
      for (const [blockedIndex, blockedScenario] of plan.scenarios.entries()) {
        if (blockedIndex <= index) continue;
        const blockedDirectory = path.join(output, blockedScenario.id);
        mkdirSync(blockedDirectory, { recursive: true });
        const blockedReportPath = path.join(blockedDirectory, "result.json");
        const blockedReport = {
          order: blockedIndex + 1,
          id: blockedScenario.id,
          scope: blockedScenario.scope,
          manifestSha256: blockedScenario.manifestSha256,
          nestedPlan: nestedPlanSummary(nestedPlans[blockedIndex]),
          reportPath: blockedReportPath,
          process: null,
          evidence: null,
          firstFailure: {
            code: "FROZEN_ENTRY_PROCESS_CLEANUP_UNCONFIRMED",
            priorScenarioId: scenario.id,
            cleanup: child.cleanup,
          },
        };
        report.scenarioReports.push(blockedReport);
        report.ledger = recordFrozenScenarioOutcome(report.ledger, blockedScenario.id, {
          state: "NOT_EXECUTED",
          reason: "ENVIRONMENT_BLOCKED",
          details: blockedReport,
        });
      }
      writeReport();
      break;
    }
  }
  const summary = summarizeFrozenScenarioLedger(report.ledger);
  report.summary = summary;
  report.state = summary.FAIL > 0 || summary.NOT_EXECUTED > 0 ? "FAIL" : "PASS";
  writeReport();
  if (print) printJson(report);
  return { exitCode: report.state === "PASS" ? 0 : 1, reportDirectory: output, report };
}

async function main(argv) {
  const options = parseFrozenEntryArgs(argv);
  if (options.mode === "list") {
    printJson({
      mode: "list",
      execution: "node tests/e2e/electron/frozen-html-scenarios.mjs",
      scenarios: listFrozenScenarioDefinitions(),
      note: "Listing does not start Electron and does not discover or substitute targets.",
    });
    return 0;
  }
  if (options.mode === "preflight") {
    if (!process.env.STEMMIO_REAL_HTML_DIR) {
      throw Object.assign(new Error("Set STEMMIO_REAL_HTML_DIR for the read-only capability preflight."), {
        code: "FROZEN_ENTRY_CORPUS_REQUIRED",
      });
    }
    await ensureRendererBuilt();
    if (!String(process.env.STEMMIO_REAL_HTML_FILE_INDEXES || "").trim()) {
      return runIsolatedCapabilityPreflight();
    }
    const result = await runCommand(process.execPath, [path.join(electronDirectory, "local-html-corpus.mjs")], {
      env: { ...process.env, STEMMIO_REAL_HTML_MODE: "capability-preflight-only" },
    });
    return result.spawnError || result.timedOut || result.exitCode !== 0 || result.cleanup?.confirmed !== true
      ? 1 : 0;
  }

  const currentVersion = workspaceSourceFingerprint(productRoot);
  const plan = readFrozenScenarioPlanFile(options.manifestPath, options.manifestSha256, currentVersion);
  const nestedPlans = await validateNestedFrozenScenarioPlans(plan, currentVersion);
  if (options.mode === "plan") {
    printJson({ mode: "plan", plan: planSummary(plan), note: "Plan validation is read-only; Electron was not started." });
    return 0;
  }
  return (await executePlan(plan, currentVersion, nestedPlans)).exitCode;
}

if (pathToFileURL(process.argv[1] || "").href === import.meta.url) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    printJson(reportError(error));
    process.exitCode = 1;
  }
}

import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

import { _electron as electron } from "playwright";

import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron");
const execFileAsync = promisify(execFile);
const productRoot = process.cwd();
const bridgeScript = path.join(productRoot, "bridge", "workspace-bridge.mjs");
const fixtureSizesMiB = [0.5, 1.25, 2.5];
const tokenPrefix = "PERSISTENCE_TOKEN_";
const editableCase = "persistence-benchmark";
const tempPrefix = "stemmio-persistence-benchmark-";
const defaultSamples = 7;
const defaultWarmups = 1;
const benchmarkCommand = "npm run desktop:renderer && node scripts/benchmark-persistence.mjs";
const frozenMainAllowlist = new Set([
  "docs/DEVELOPMENT.md",
  "docs/PERSISTENCE_PERFORMANCE_DECISION.md",
  "package.json",
  "scripts/benchmark-persistence.mjs",
  "tests/TEST_STRATEGY.md",
]);

const budgets = Object.freeze({
  bridgeTransactionP95Ms: 500,
  electronAutosaveP95Ms: 1_250,
  dirtySwitchP95Ms: 750,
  dirtyCloseP95Ms: 750,
  cleanCloseP95Ms: 50,
  rendererEventLoopGapP95Ms: 50,
  operationMemoryDeltaP95MiB: 32,
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function bytes(value) {
  return Buffer.byteLength(value, "utf8");
}

function formatNumber(value, digits = 1) {
  return Number(value || 0).toFixed(digits);
}

function token(index) {
  return `${tokenPrefix}${String(index).padStart(4, "0")}`;
}

function replacement(html, nextToken) {
  const next = String(nextToken);
  assert(next.length === token(0).length, "Benchmark token width drifted.");
  const result = html.replace(new RegExp(`${tokenPrefix}\\d{4}`, "u"), next);
  assert(result !== html, "Benchmark source token is missing.");
  return result;
}

async function assertSourceBytes(sourcePath, expectedHtml, operation) {
  const actualHtml = await readFile(sourcePath, "utf8");
  if (actualHtml === expectedHtml) return;
  let offset = 0;
  while (offset < actualHtml.length && actualHtml[offset] === expectedHtml[offset]) offset += 1;
  const start = Math.max(0, offset - 80);
  const end = offset + 160;
  throw new Error(
    `${operation} did not preserve the complete edited source bytes at offset ${offset}. `
      + `Expected ${JSON.stringify(expectedHtml.slice(start, end))}; received ${JSON.stringify(actualHtml.slice(start, end))}.`,
  );
}

function fixtureHtml(sizeMiB, initialToken = token(0)) {
  const targetBytes = Math.round(sizeMiB * 1024 * 1024);
  const header = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Stemmio persistence benchmark</title><style>body{font:14px system-ui}.card{border:1px solid #ddd;margin:8px;padding:8px}</style></head><body><main><p data-native-case="${editableCase}" data-native-mode="native-editable">${initialToken}</p>`;
  const footer = "</main></body></html>";
  const paragraph = "structured-persistence-content-".repeat(56);
  const card = `<section class="card"><h2>Structured section</h2><p>${paragraph}</p><ul><li>source bytes stay authoritative</li><li>atomic recovery stays enabled</li></ul></section>`;
  let content = "";
  while (bytes(header) + bytes(content) + bytes(card) + bytes(footer) <= targetBytes - 7) {
    content += card;
  }
  const paddingBytes = targetBytes - bytes(header) - bytes(content) - bytes(footer);
  assert(paddingBytes >= 7, `Unable to pad ${sizeMiB}MiB fixture safely.`);
  const html = `${header}${content}<!--${"x".repeat(paddingBytes - 7)}-->${footer}`;
  assert(bytes(html) === targetBytes, `Fixture ${sizeMiB}MiB has ${bytes(html)} bytes.`);
  return html;
}

function percentile(values, ratio) {
  assert(values.length > 0, "Cannot calculate a percentile without samples.");
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(ordered.length * ratio) - 1)];
}

function summary(values) {
  const numeric = values.filter(Number.isFinite);
  assert(numeric.length > 0, "Benchmark metric is missing samples.");
  return {
    samples: numeric.length,
    min: Number(formatNumber(Math.min(...numeric))),
    p50: Number(formatNumber(percentile(numeric, 0.5))),
    p95: Number(formatNumber(percentile(numeric, 0.95))),
    max: Number(formatNumber(Math.max(...numeric))),
  };
}

function parseOptions() {
  const options = {
    samples: defaultSamples,
    warmups: defaultWarmups,
    report: null,
    sizesMiB: [...fixtureSizesMiB],
  };
  for (let index = 2; index < process.argv.length; index += 1) {
    const argument = process.argv[index];
    if (argument === "--samples" || argument === "--warmups" || argument === "--report" || argument === "--sizes") {
      const value = process.argv[index + 1];
      assert(value, `${argument} needs a value.`);
      index += 1;
      if (argument === "--report") {
        options.report = value;
      } else if (argument === "--sizes") {
        const sizes = value.split(",").map((entry) => Number(entry));
        assert(
          sizes.length > 0 && sizes.every((size) => fixtureSizesMiB.includes(size)),
          "--sizes must be a comma-separated subset of 0.5,1.25,2.5.",
        );
        options.sizesMiB = sizes;
      } else {
        const key = argument.slice(2);
        const number = Number(value);
        assert(Number.isSafeInteger(number) && number > 0, `${argument} must be a positive integer.`);
        options[key] = number;
      }
      continue;
    }
    if (argument === "--help") {
      process.stdout.write("Usage: npm run benchmark:persistence -- [--samples 7] [--warmups 1] [--sizes 0.5,1.25,2.5] [--report path]\n");
      process.exit(0);
    }
    throw new Error(`Unknown benchmark option: ${argument}`);
  }
  return options;
}

async function command(commandName, args) {
  const result = await execFileAsync(commandName, args, { cwd: productRoot });
  return result.stdout.trim();
}

async function gitValue(...args) {
  return command("git", args);
}

async function assertFrozenMainRuntimeInputs() {
  const [changed, baselinePackageText, currentPackageText] = await Promise.all([
    gitValue("diff", "--name-only", "origin/main"),
    command("git", ["show", "origin/main:package.json"]),
    readFile(path.join(productRoot, "package.json"), "utf8"),
  ]);
  const changedFiles = changed.split("\n").filter(Boolean);
  const unexpected = changedFiles.filter((file) => !frozenMainAllowlist.has(file));
  assert(
    unexpected.length === 0,
    `Benchmark branch changed frozen-main runtime inputs: ${unexpected.join(", ")}`,
  );

  const baselinePackage = JSON.parse(baselinePackageText);
  const currentPackage = JSON.parse(currentPackageText);
  assert(
    currentPackage.scripts?.["benchmark:persistence"] === benchmarkCommand,
    "Benchmark package command drifted from the frozen-main harness command.",
  );
  delete currentPackage.scripts["benchmark:persistence"];
  assert(
    JSON.stringify(currentPackage) === JSON.stringify(baselinePackage),
    "Benchmark branch modified package.json beyond the benchmark command.",
  );
  return changedFiles;
}

async function directoryDigest(directory) {
  const digest = createHash("sha256");
  async function visit(current, relative = "") {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const child = path.join(current, entry.name);
      const childRelative = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) {
        digest.update(`directory:${childRelative}\0`);
        await visit(child, childRelative);
      } else if (entry.isFile()) {
        digest.update(`file:${childRelative}\0`);
        digest.update(await readFile(child));
      }
    }
  }
  await visit(directory);
  return `sha256:${digest.digest("hex")}`;
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address === "object", "Unable to reserve a Bridge port.");
  const port = address.port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function requestJson(baseUrl, pathname, { body, headers } = {}) {
  const requestText = body === undefined ? null : JSON.stringify(body);
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${pathname}`, {
    method: requestText === null ? "GET" : "POST",
    headers: requestText === null
      ? headers
      : { "content-type": "application/json", ...headers },
    body: requestText ?? undefined,
  });
  const responseText = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(responseText);
  } catch (error) {
    throw new Error(`Bridge returned non-JSON ${response.status}: ${responseText.slice(0, 300)}`, { cause: error });
  }
  return {
    status: response.status,
    body: parsed,
    requestBytes: requestText === null ? 0 : bytes(requestText),
    responseBytes: bytes(responseText),
    durationMs: performance.now() - startedAt,
  };
}

async function waitForHealth(baseUrl, child, logs) {
  const deadline = Date.now() + 15_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Bridge exited with ${child.exitCode}\n${logs.stderr}`);
    }
    try {
      const health = await requestJson(baseUrl, "/health");
      if (health.status === 200) return;
    } catch (error) {
      lastError = error;
    }
    await delay(30);
  }
  throw new Error(`Bridge health check timed out: ${lastError ?? "unknown"}\n${logs.stderr}`);
}

async function startBridge(workspace, extraEnvironment = {}) {
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const logs = { stderr: "" };
  const child = spawn(process.execPath, [bridgeScript], {
    cwd: productRoot,
    env: {
      ...process.env,
      STEMMIO_WORKSPACE: workspace,
      STEMMIO_PROJECT_FILES_ROOT: path.join(workspace, "project-files"),
      STEMMIO_BRIDGE_PORT: String(port),
      ...extraEnvironment,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    logs.stderr += chunk;
  });
  await waitForHealth(baseUrl, child, logs);
  return { baseUrl, child, logs };
}

async function stopBridge(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    delay(2_000).then(() => false),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("exit", resolve));
  }
}

async function openWorkspace(baseUrl, sourcePath) {
  const preview = await requestJson(
    baseUrl,
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert(
    preview.status === 200 && preview.body?.ok === true,
    `Bridge could not open benchmark workspace: ${preview.status} ${JSON.stringify(preview.body)}`,
  );
  if (preview.body.registered !== false) {
    assert(preview.body.registered === true, "Bridge workspace response did not report registration state.");
    return preview.body;
  }
  const ensured = await requestJson(baseUrl, "/project/ensure", {
    body: {
      sourcePath,
      expectedSourceSha256: preview.body.currentHtmlSha256,
    },
  });
  assert(
    ensured.status === 200 && ensured.body?.ok === true && ensured.body.registered === true,
    `Bridge could not register benchmark source: ${ensured.status} ${JSON.stringify(ensured.body)}`,
  );
  return ensured.body;
}

function assertRecoveredWorkspace(workspace, {
  projectId,
  documentId,
  expectedSha256,
  persistedRevision,
}) {
  assert(workspace.registered === true, "Restart recovery did not reopen a registered workspace.");
  assert(workspace.projectId === projectId, "Restart recovery reopened a different project.");
  assert(workspace.documentId === documentId, "Restart recovery reopened a different document.");
  assert(workspace.currentHtmlSha256 === expectedSha256, "Restart recovery workspace Hash did not match recovered source bytes.");
  assert(workspace.current?.sha256 === expectedSha256, "Restart recovery current source Hash did not match recovered source bytes.");
  assert(
    workspace.runtimeState?.editRevision === persistedRevision
      && workspace.runtimeState?.lastPersistedRevision === persistedRevision,
    "Restart recovery workspace revision did not match the recovered autosave.",
  );
}

async function readRssKiB(pid) {
  try {
    const output = await command("/bin/ps", ["-o", "rss=", "-p", String(pid)]);
    const value = Number(output.trim());
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

async function observeRss(pid) {
  let baselineKiB = await readRssKiB(pid);
  let peakKiB = baselineKiB;
  let finalKiB = baselineKiB;
  let sampling = false;
  const sample = async () => {
    if (sampling) return;
    sampling = true;
    try {
      const value = await readRssKiB(pid);
      if (value === null) return;
      if (baselineKiB === null) baselineKiB = value;
      peakKiB = Math.max(peakKiB ?? value, value);
      finalKiB = value;
    } finally {
      sampling = false;
    }
  };
  const timer = setInterval(() => void sample(), 25);
  return {
    async stop() {
      clearInterval(timer);
      await sample();
      return {
        baselineKiB,
        peakKiB,
        finalKiB,
        deltaMiB: Number(formatNumber(Math.max(0, (peakKiB ?? 0) - (baselineKiB ?? 0)) / 1024)),
      };
    },
  };
}

async function observeBridgeAvailability(baseUrl) {
  const intervalMs = 20;
  let lastCompletedAt = performance.now();
  let maxDelayMs = 0;
  let failedProbes = 0;
  let samples = 0;
  let inFlight = false;
  const probe = async () => {
    if (inFlight) return;
    inFlight = true;
    try {
      const health = await requestJson(baseUrl, "/health");
      if (health.status !== 200) failedProbes += 1;
    } catch {
      failedProbes += 1;
    } finally {
      const completedAt = performance.now();
      maxDelayMs = Math.max(maxDelayMs, completedAt - lastCompletedAt - intervalMs);
      lastCompletedAt = completedAt;
      samples += 1;
      inFlight = false;
    }
  };
  const timer = setInterval(() => void probe(), intervalMs);
  return {
    async stop() {
      clearInterval(timer);
      await probe();
      return {
        samples,
        failedProbes,
        maxDelayMs: Number(formatNumber(Math.max(0, maxDelayMs))),
      };
    },
  };
}

async function createBridgeFixture(root, sizeMiB) {
  const workspace = path.join(root, "workspace");
  const sources = path.join(root, "sources");
  await mkdir(workspace, { recursive: true });
  await mkdir(sources, { recursive: true });
  const sourcePath = path.join(sources, `persistence-${sizeMiB}MiB.html`);
  await writeFile(sourcePath, fixtureHtml(sizeMiB), "utf8");
  return { workspace, sourcePath };
}

async function runBridgeSamples(runRoot, sizeMiB, options) {
  const fixtureRoot = await mkdtemp(path.join(runRoot, `bridge-${sizeMiB}-`));
  let bridge = null;
  try {
    const fixture = await createBridgeFixture(fixtureRoot, sizeMiB);
    bridge = await startBridge(fixture.workspace);
    const opened = await openWorkspace(bridge.baseUrl, fixture.sourcePath);
    const sourcePath = opened.sourcePath || opened.openTarget?.exactSourcePath || fixture.sourcePath;
    let currentHtml = await readFile(sourcePath, "utf8");
    let expectedSha256 = opened.currentHtmlSha256 ?? sha256(currentHtml);
    const samples = [];
    const total = options.warmups + options.samples;
    for (let index = 0; index < total; index += 1) {
      const nextHtml = replacement(currentHtml, token(index + 1));
      const rss = await observeRss(bridge.child.pid);
      const availability = await observeBridgeAvailability(bridge.baseUrl);
      const result = await requestJson(bridge.baseUrl, "/autosave", {
        body: {
          sourcePath,
          projectId: opened.projectId,
          documentId: opened.documentId,
          expectedSourceSha256: expectedSha256,
          editRevision: index + 1,
          html: nextHtml,
        },
      });
      const [memory, bridgeAvailability] = await Promise.all([rss.stop(), availability.stop()]);
      assert(result.status === 200, `Bridge autosave failed at ${sizeMiB}MiB: ${result.status} ${JSON.stringify(result.body?.error || result.body)}`);
      assert(result.body.content === nextHtml, "Bridge acknowledgement did not preserve exact source bytes.");
      assert(result.body.sha256 === sha256(nextHtml), "Bridge acknowledgement Hash did not match source bytes.");
      assert(await readFile(sourcePath, "utf8") === nextHtml, "Bridge autosave did not persist exact source bytes.");
      currentHtml = nextHtml;
      expectedSha256 = result.body.currentHtmlSha256 ?? result.body.sha256;
      if (index >= options.warmups) {
        samples.push({
          transactionMs: Number(formatNumber(result.durationMs)),
          requestBytes: result.requestBytes,
          responseBytes: result.responseBytes,
          memory,
          bridgeAvailability,
        });
      }
    }
    return {
      sourceBytes: bytes(currentHtml),
      transaction: summary(samples.map((sample) => sample.transactionMs)),
      requestBytes: summary(samples.map((sample) => sample.requestBytes)),
      responseBytes: summary(samples.map((sample) => sample.responseBytes)),
      memoryDeltaMiB: summary(samples.map((sample) => sample.memory.deltaMiB)),
      bridgeAvailabilityGapMs: summary(samples.map((sample) => sample.bridgeAvailability.maxDelayMs)),
      bridgeAvailabilityFailures: samples.reduce((sum, sample) => sum + sample.bridgeAvailability.failedProbes, 0),
      warmFinalRssKiB: samples.map((sample) => sample.memory.finalKiB),
    };
  } finally {
    await stopBridge(bridge?.child);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function runSafetyChecks(runRoot, sizeMiB) {
  const safetyRoot = await mkdtemp(path.join(runRoot, `safety-${sizeMiB}-`));
  let conflictBridge = null;
  let failedBridge = null;
  let recoveredBridge = null;
  try {
    const conflict = await createBridgeFixture(path.join(safetyRoot, "conflict"), sizeMiB);
    conflictBridge = await startBridge(conflict.workspace);
    const opened = await openWorkspace(conflictBridge.baseUrl, conflict.sourcePath);
    const conflictPath = opened.sourcePath || opened.openTarget?.exactSourcePath || conflict.sourcePath;
    const before = await readFile(conflictPath, "utf8");
    const external = replacement(before, token(7_001));
    const candidate = replacement(before, token(7_002));
    await writeFile(conflictPath, external, "utf8");
    const conflicted = await requestJson(conflictBridge.baseUrl, "/autosave", {
      body: {
        sourcePath: conflictPath,
        projectId: opened.projectId,
        documentId: opened.documentId,
        expectedSourceSha256: opened.currentHtmlSha256 ?? sha256(before),
        editRevision: 1,
        html: candidate,
      },
    });
    assert(conflicted.status === 409, "External-write conflict did not fail closed.");
    assert(
      [
        "SOURCE_CHANGED",
        "SOURCE_HASH_CONFLICT",
        "WORKING_COPY_CONFLICT",
        "PROJECT_CONTEXT_SOURCE_REPLACED",
      ].includes(conflicted.body.error?.code),
      `External-write conflict returned ${conflicted.body.error?.code ?? "no error code"}.`,
    );
    assert(await readFile(conflictPath, "utf8") === external, "Conflict path overwrote external source bytes.");
    await stopBridge(conflictBridge.child);
    conflictBridge = null;

    const recovery = await createBridgeFixture(path.join(safetyRoot, "recovery"), sizeMiB);
    failedBridge = await startBridge(recovery.workspace, {
      STEMMIO_FAILPOINT: "save-source-written",
    });
    const recoveringProject = await openWorkspace(failedBridge.baseUrl, recovery.sourcePath);
    const recoveryPath = recoveringProject.sourcePath
      || recoveringProject.openTarget?.exactSourcePath
      || recovery.sourcePath;
    const recoveryBefore = await readFile(recoveryPath, "utf8");
    const recoveryTarget = replacement(recoveryBefore, token(8_001));
    const interrupted = await requestJson(failedBridge.baseUrl, "/autosave", {
      body: {
        sourcePath: recoveryPath,
        projectId: recoveringProject.projectId,
        documentId: recoveringProject.documentId,
        expectedSourceSha256: recoveringProject.currentHtmlSha256 ?? sha256(recoveryBefore),
        editRevision: 1,
        html: recoveryTarget,
      },
    });
    assert(interrupted.status === 500, "Injected recovery boundary did not interrupt autosave.");
    await stopBridge(failedBridge.child);
    failedBridge = null;
    recoveredBridge = await startBridge(recovery.workspace);
    const recoveredWorkspace = await openWorkspace(recoveredBridge.baseUrl, recoveryPath);
    assert(await readFile(recoveryPath, "utf8") === recoveryTarget, "Restart recovery did not restore exact source bytes.");
    assertRecoveredWorkspace(recoveredWorkspace, {
      projectId: recoveringProject.projectId,
      documentId: recoveringProject.documentId,
      expectedSha256: sha256(recoveryTarget),
      persistedRevision: 1,
    });
    return {
      externalConflict: "passed",
      restartRecovery: "passed",
      exactBytesOracle: "passed",
    };
  } finally {
    await stopBridge(conflictBridge?.child);
    await stopBridge(failedBridge?.child);
    await stopBridge(recoveredBridge?.child);
    await rm(safetyRoot, { recursive: true, force: true });
  }
}

async function seedElectronProjects(userData, activePath, recentPaths) {
  await mkdir(userData, { recursive: true });
  await writeFile(path.join(userData, "html-projects.json"), JSON.stringify({
    version: 1,
    activePath,
    recent: recentPaths.map((sourcePath) => ({
      path: sourcePath,
      name: path.basename(sourcePath),
      lastOpenedAt: Date.now(),
    })),
  }), "utf8");
}

async function launchElectron(userData, activePath = null, recentPaths = []) {
  if (activePath) await seedElectronProjects(userData, activePath, recentPaths);
  const electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: [path.join(productRoot, "desktop", "main.mjs")],
    cwd: productRoot,
    env: {
      ...process.env,
      STEMMIO_E2E: "1",
      STEMMIO_E2E_USER_DATA_DIR: userData,
      STEMMIO_WORKSPACE: path.join(userData, "workspace"),
      STEMMIO_PROJECT_FILES_ROOT: path.join(userData, "project-files"),
    },
  });
  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  const rendererUrl = page.url();
  const rendererProcessId = await electronApp.evaluate(({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url);
    if (!window) throw new Error("Stemmio main BrowserWindow is unavailable.");
    window.webContents.setBackgroundThrottling(false);
    return window.webContents.getOSProcessId();
  }, rendererUrl);
  assert(Number.isSafeInteger(rendererProcessId) && rendererProcessId > 0, "Stemmio renderer PID is unavailable for RSS sampling.");
  await page.waitForFunction(() => document.visibilityState === "visible");
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  return { electronApp, page, rendererUrl, rendererProcessId };
}

async function waitForLiveSourcePath(page, expectedProjectId = null) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const sourcePath = await page.evaluate(async (expectedId) => {
      if (document.querySelector("main.workbench")?.getAttribute("data-project-state") !== "ready") {
        return null;
      }
      const project = await window.stemmioProjects?.getActiveProject?.();
      if (
        typeof project?.sourcePath !== "string"
        || !project.sourcePath
        || (expectedId && project.projectId !== expectedId)
      ) return null;
      return project.sourcePath;
    }, expectedProjectId).catch(() => null);
    if (sourcePath) return sourcePath;
    await page.waitForTimeout(50);
  }
  throw new Error("Stemmio did not expose the expected imported Working Copy path.");
}

async function currentFrame(page, expectedPath, expectedToken = null) {
  await page.waitForFunction(async (sourcePath) => {
    const project = await window.stemmioProjects?.getActiveProject?.();
    return project?.sourcePath === sourcePath
      && document.querySelector("main.workbench")?.getAttribute("data-project-state") === "ready";
  }, expectedPath, { timeout: 30_000 });
  const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
  await editor.waitFor({ state: "visible" });
  const editorHandle = await editor.elementHandle();
  await page.waitForFunction((element) => element?.getAttribute("data-render-verified") === "true", editorHandle, { timeout: 30_000 });
  const iframe = editor.locator('iframe[title*="HTML"]');
  await iframe.waitFor({ state: "attached", timeout: 30_000 });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const iframeHandle = await iframe.elementHandle();
    const frame = await iframeHandle?.contentFrame();
    if (frame) {
      try {
        const target = frame.locator(`[data-native-case="${editableCase}"]`);
        await target.waitFor({ state: "attached", timeout: 1_000 });
        if (expectedToken && await target.textContent() !== expectedToken) {
          await page.waitForTimeout(50);
          continue;
        }
        return frame;
      } catch {
        // The old document can remain attached for a short handoff while the
        // verified next source creates its fresh frame.
      }
    }
    await page.waitForTimeout(50);
  }
  throw new Error("Stemmio benchmark canvas did not expose its fresh edit frame.");
}

async function activateAndReplace(page, frame, nextToken) {
  const target = frame.locator(`[data-native-case="${editableCase}"]`);
  await target.scrollIntoViewIfNeeded();
  const position = await target.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let text = walker.nextNode(); text; text = walker.nextNode()) {
      if (!text.data.trim()) continue;
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 1);
      const glyph = range.getClientRects()[0];
      const host = element.getBoundingClientRect();
      if (!glyph || (!glyph.width && !glyph.height)) continue;
      return {
        x: glyph.left - host.left + Math.max(1, Math.min(glyph.width / 2, 3)),
        y: glyph.top - host.top + Math.max(1, glyph.height / 2),
      };
    }
    throw new Error("Benchmark editable token has no visible text glyph.");
  });
  await target.dblclick({ position });
  await frame.waitForFunction((caseId) => {
    const targetElement = document.querySelector(`[data-native-case=${JSON.stringify(caseId)}]`);
    return targetElement instanceof HTMLElement
      && targetElement.isContentEditable
      && document.activeElement === targetElement;
  }, editableCase, { timeout: 10_000 });
  await target.evaluate((element) => {
    element.focus();
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = document.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (document.activeElement !== element || selection?.toString() !== element.textContent) {
      throw new Error("Benchmark editable token selection did not remain active.");
    }
  });
  await page.keyboard.insertText(nextToken);
  await frame.waitForFunction(({ caseId, expectedToken }) => {
    const targetElement = document.querySelector(`[data-native-case=${JSON.stringify(caseId)}]`);
    return targetElement?.textContent === expectedToken;
  }, { caseId: editableCase, expectedToken: nextToken }, { timeout: 10_000 });
}

async function persistedRevision(page, minimumRevision) {
  await page.waitForFunction((minimum) => {
    const indicator = document.querySelector("[data-persist-state]");
    const editRevision = Number(indicator?.getAttribute("data-edit-revision"));
    const persisted = Number(indicator?.getAttribute("data-persisted-revision"));
    return indicator?.getAttribute("data-persist-state") === "idle"
      && Number.isSafeInteger(editRevision)
      && editRevision > minimum
      && editRevision === persisted;
  }, minimumRevision, { timeout: 35_000 });
  const value = await page.locator("[data-persist-state]").first().getAttribute("data-persisted-revision");
  return Number(value);
}

async function startRendererGapMonitor(page) {
  await page.evaluate(() => {
    const state = { active: true, last: performance.now(), maxGapMs: 0, samples: 0 };
    globalThis.__STEMMIO_PERSISTENCE_GAP_MONITOR__ = state;
    const frame = () => {
      if (!state.active) return;
      const now = performance.now();
      state.maxGapMs = Math.max(state.maxGapMs, now - state.last);
      state.last = now;
      state.samples += 1;
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
  return {
    async stop() {
      return page.evaluate(() => {
        const state = globalThis.__STEMMIO_PERSISTENCE_GAP_MONITOR__;
        if (!state) return { maxGapMs: 0, samples: 0 };
        state.active = false;
        delete globalThis.__STEMMIO_PERSISTENCE_GAP_MONITOR__;
        return { maxGapMs: state.maxGapMs, samples: state.samples };
      });
    },
  };
}

async function closeElectronGracefully(electronApp, rendererUrl) {
  const closed = electronApp.waitForEvent("close", { timeout: 35_000 });
  const requested = await electronApp.evaluate(({ BrowserWindow }, url) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => candidate.webContents.getURL() === url);
    if (!window) return false;
    window.close();
    return true;
  }, rendererUrl);
  assert(requested, "Stemmio main BrowserWindow disappeared before close measurement.");
  await closed;
}

async function forceCloseElectron(electronApp) {
  if (!electronApp) return;
  await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {});
}

async function removeElectronUserData(userData, temporaryParent) {
  assert(
    path.dirname(path.resolve(userData)) === temporaryParent
      && path.basename(userData).startsWith("stemmio-native-e2e-"),
    "Refusing to remove an unexpected Electron benchmark user-data directory.",
  );
  // Chromium can finish one final storage write shortly after Electron's close
  // event; retain the same bounded retry posture as the native Electron suite.
  await delay(200);
  await rm(userData, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

async function runElectronSession(runRoot, sizeMiB, sequence, sampleIndex) {
  const sessionRoot = await mkdtemp(path.join(runRoot, `electron-${sizeMiB}-`));
  const sources = path.join(sessionRoot, "sources");
  // Electron validates this value with path.resolve(tmpdir()), so preserve the
  // system spelling (for example /var rather than its /private realpath).
  const temporaryParent = path.resolve(os.tmpdir());
  const userData = await mkdtemp(path.join(temporaryParent, "stemmio-native-e2e-"));
  const sourceA = path.join(sources, `persistence-${sizeMiB}-A.html`);
  const sourceB = path.join(sources, `persistence-${sizeMiB}-B.html`);
  const initialSourceA = fixtureHtml(sizeMiB);
  const initialSourceB = fixtureHtml(sizeMiB, token(6_000));
  await mkdir(sources, { recursive: true });
  await writeFile(sourceA, initialSourceA, "utf8");
  await writeFile(sourceB, initialSourceB, "utf8");
  let electronApp = null;
  try {
    const launched = await launchElectron(userData, sourceA, [sourceA, sourceB]);
    electronApp = launched.electronApp;
    const liveA = await waitForLiveSourcePath(launched.page);
    const managedSourceA = await readFile(liveA, "utf8");
    assert(
      managedSourceA.includes(token(0)),
      "Imported benchmark Working Copy lost the frozen edit token.",
    );
    const repository = new ProjectFileRepository({
      projectsRoot: path.dirname(path.dirname(liveA)),
    });
    const importedB = await repository.importExternal({
      sourcePath: sourceB,
      expectedSourceSha256: sha256(initialSourceB),
    });
    assert(
      importedB?.target?.projectId && importedB?.target?.exactSourcePath,
      "Benchmark project B did not become a registered Working Copy.",
    );
    let frame = await currentFrame(launched.page, liveA, token(0));
    const initialRevision = Number(await launched.page.locator("[data-persist-state]").first().getAttribute("data-persisted-revision"));

    if (sequence === "dirty-close") {
      const dirtyToken = token(5_000 + sampleIndex);
      await activateAndReplace(launched.page, frame, dirtyToken);
      await launched.page.waitForFunction((minimum) => Number(document.querySelector("[data-persist-state]")?.getAttribute("data-edit-revision")) > minimum, initialRevision, { timeout: 10_000 });
      const [gap, memory] = await Promise.all([
        startRendererGapMonitor(launched.page),
        observeRss(launched.rendererProcessId),
      ]);
      const startedAt = performance.now();
      await closeElectronGracefully(electronApp, launched.rendererUrl);
      const dirtyCloseDurationMs = Number(formatNumber(performance.now() - startedAt));
      const [rendererGap, rendererMemory] = await Promise.all([gap.stop().catch(() => ({ maxGapMs: 0, samples: 0 })), memory.stop()]);
      electronApp = null;
      const reopened = await launchElectron(userData);
      electronApp = reopened.electronApp;
      const recoveredA = await waitForLiveSourcePath(reopened.page);
      await currentFrame(reopened.page, recoveredA, dirtyToken);
      await assertSourceBytes(recoveredA, replacement(managedSourceA, dirtyToken), "Dirty close recovery");
      await closeElectronGracefully(electronApp, reopened.rendererUrl);
      electronApp = null;
      return {
        dirtyClose: {
          durationMs: dirtyCloseDurationMs,
          rendererGapMs: Number(formatNumber(rendererGap.maxGapMs)),
          rendererMemory,
        },
      };
    }

    const autosaveToken = token(1_000 + sampleIndex);
    const [autosaveGap, autosaveMemory] = await Promise.all([
      startRendererGapMonitor(launched.page),
      observeRss(launched.rendererProcessId),
    ]);
    const autosaveStartedAt = performance.now();
    await activateAndReplace(launched.page, frame, autosaveToken);
    await persistedRevision(launched.page, initialRevision);
    const autosaveDurationMs = Number(formatNumber(performance.now() - autosaveStartedAt));
    const [autosaveRendererGap, autosaveRendererMemory] = await Promise.all([autosaveGap.stop(), autosaveMemory.stop()]);
    await assertSourceBytes(liveA, replacement(managedSourceA, autosaveToken), "Electron autosave");

    frame = await currentFrame(launched.page, liveA, autosaveToken);
    const switchToken = token(2_000 + sampleIndex);
    await activateAndReplace(launched.page, frame, switchToken);
    const [switchGap, switchMemory] = await Promise.all([
      startRendererGapMonitor(launched.page),
      observeRss(launched.rendererProcessId),
    ]);
    const sidebar = launched.page.locator(".workbench-global-sidebar");
    if (await sidebar.getAttribute("data-open") !== "true") {
      await launched.page.getByRole("button", { name: "展开左侧边栏" }).click();
    }
    const switchStartedAt = performance.now();
    const projectB = sidebar.locator(".sidebar-project-item")
      .filter({ hasText: path.basename(sourceB, path.extname(sourceB)) })
      .first();
    await projectB.locator(".sidebar-project-row").click();
    await projectB.locator(".sidebar-project-current-row").click();
    const liveB = await waitForLiveSourcePath(
      launched.page,
      importedB.target.projectId,
    );
    await currentFrame(launched.page, liveB, token(6_000));
    const dirtySwitchDurationMs = Number(formatNumber(performance.now() - switchStartedAt));
    const [switchRendererGap, switchRendererMemory] = await Promise.all([switchGap.stop(), switchMemory.stop()]);
    await assertSourceBytes(liveA, replacement(managedSourceA, switchToken), "Dirty switch");

    const [closeGap, closeMemory] = await Promise.all([
      startRendererGapMonitor(launched.page),
      observeRss(launched.rendererProcessId),
    ]);
    const closeStartedAt = performance.now();
    await closeElectronGracefully(electronApp, launched.rendererUrl);
    const cleanCloseDurationMs = Number(formatNumber(performance.now() - closeStartedAt));
    const [cleanCloseRendererGap, cleanCloseRendererMemory] = await Promise.all([closeGap.stop().catch(() => ({ maxGapMs: 0, samples: 0 })), closeMemory.stop()]);
    electronApp = null;
    return {
      autosave: {
        durationMs: autosaveDurationMs,
        rendererGapMs: Number(formatNumber(autosaveRendererGap.maxGapMs)),
        rendererMemory: autosaveRendererMemory,
      },
      dirtySwitch: {
        durationMs: dirtySwitchDurationMs,
        rendererGapMs: Number(formatNumber(switchRendererGap.maxGapMs)),
        rendererMemory: switchRendererMemory,
      },
      cleanClose: {
        durationMs: cleanCloseDurationMs,
        rendererGapMs: Number(formatNumber(cleanCloseRendererGap.maxGapMs)),
        rendererMemory: cleanCloseRendererMemory,
      },
    };
  } finally {
    await forceCloseElectron(electronApp);
    await rm(sessionRoot, { recursive: true, force: true });
    await removeElectronUserData(userData, temporaryParent);
  }
}

async function runElectronSamples(runRoot, sizeMiB, options) {
  const autosave = [];
  const dirtySwitch = [];
  const cleanClose = [];
  const dirtyClose = [];
  const total = options.warmups + options.samples;
  for (let index = 0; index < total; index += 1) {
    const switchAndCleanClose = await runElectronSession(runRoot, sizeMiB, "switch-clean-close", index);
    const dirty = await runElectronSession(runRoot, sizeMiB, "dirty-close", index);
    if (index < options.warmups) continue;
    autosave.push(switchAndCleanClose.autosave);
    dirtySwitch.push(switchAndCleanClose.dirtySwitch);
    cleanClose.push(switchAndCleanClose.cleanClose);
    dirtyClose.push(dirty.dirtyClose);
  }
  const all = [...autosave, ...dirtySwitch, ...cleanClose, ...dirtyClose];
  return {
    autosave: summary(autosave.map((sample) => sample.durationMs)),
    dirtySwitch: summary(dirtySwitch.map((sample) => sample.durationMs)),
    dirtyClose: summary(dirtyClose.map((sample) => sample.durationMs)),
    cleanClose: summary(cleanClose.map((sample) => sample.durationMs)),
    rendererEventLoopGapMs: summary(all.map((sample) => sample.rendererGapMs)),
    rendererMemoryDeltaMiB: summary(all.map((sample) => sample.rendererMemory.deltaMiB)),
  };
}

function hasStrictMonotonicGrowth(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length >= 3 && usable.every((value, index) => index === 0 || value > usable[index - 1]);
}

function decisionFor(fixtures) {
  const largest = fixtures.find((fixture) => fixture.sizeMiB === 2.5) || fixtures[fixtures.length - 1];
  assert(largest, "At least one HTML fixture is required for the decision.");
  const checks = [
    ["Bridge transaction p95", largest.bridge.transaction.p95, budgets.bridgeTransactionP95Ms, "ms"],
    ["Electron autosave p95", largest.electron.autosave.p95, budgets.electronAutosaveP95Ms, "ms"],
    ["Dirty switch p95", largest.electron.dirtySwitch.p95, budgets.dirtySwitchP95Ms, "ms"],
    ["Dirty close p95", largest.electron.dirtyClose.p95, budgets.dirtyCloseP95Ms, "ms"],
    ["Clean close p95", largest.electron.cleanClose.p95, budgets.cleanCloseP95Ms, "ms"],
    ["Renderer event-loop gap p95", largest.electron.rendererEventLoopGapMs.p95, budgets.rendererEventLoopGapP95Ms, "ms"],
    ["Bridge operation RSS delta p95", largest.bridge.memoryDeltaMiB.p95, budgets.operationMemoryDeltaP95MiB, "MiB"],
    ["Renderer operation RSS delta p95", largest.electron.rendererMemoryDeltaMiB.p95, budgets.operationMemoryDeltaP95MiB, "MiB"],
  ].map(([name, actual, budget, unit]) => ({
    name,
    actual,
    budget,
    unit,
    passed: actual <= budget,
  }));
  const warmGrowth = fixtures.map((fixture) => ({
    sizeMiB: fixture.sizeMiB,
    strictMonotonicGrowth: hasStrictMonotonicGrowth(fixture.bridge.warmFinalRssKiB),
  }));
  const allSafetyPassed = fixtures.every((fixture) => Object.values(fixture.safety).every((value) => value === "passed"));
  const passed = checks.every((check) => check.passed)
    && warmGrowth.every((growth) => !growth.strictMonotonicGrowth)
    && allSafetyPassed;
  return {
    result: passed ? "skip-12" : "authorize-12-pr1",
    checks,
    warmGrowth,
    allSafetyPassed,
  };
}

function renderMarkdown(report) {
  const rows = report.fixtures.map((fixture) => `| ${fixture.sizeMiB}MiB | ${fixture.bridge.transaction.p50} / ${fixture.bridge.transaction.p95} / ${fixture.bridge.transaction.max} | ${fixture.electron.autosave.p50} / ${fixture.electron.autosave.p95} / ${fixture.electron.autosave.max} | ${fixture.electron.dirtySwitch.p50} / ${fixture.electron.dirtySwitch.p95} / ${fixture.electron.dirtySwitch.max} | ${fixture.electron.dirtyClose.p50} / ${fixture.electron.dirtyClose.p95} / ${fixture.electron.dirtyClose.max} | ${fixture.electron.cleanClose.p50} / ${fixture.electron.cleanClose.p95} / ${fixture.electron.cleanClose.max} |`).join("\n");
  const budgetRows = report.decision.checks.map((check) => `| ${check.name} | ${check.actual} ${check.unit} | ≤${check.budget} ${check.unit} | ${check.passed ? "pass" : "fail"} |`).join("\n");
  const memoryRows = report.fixtures.map((fixture) => `| ${fixture.sizeMiB}MiB | ${fixture.bridge.requestBytes.p95} / ${fixture.bridge.responseBytes.p95} | ${fixture.bridge.memoryDeltaMiB.p95} | ${fixture.electron.rendererMemoryDeltaMiB.p95} | ${fixture.electron.rendererEventLoopGapMs.p95} | ${fixture.bridge.bridgeAvailabilityGapMs.p95} |`).join("\n");
  const safetyRows = report.fixtures.map((fixture) => `| ${fixture.sizeMiB}MiB | ${fixture.safety.externalConflict} | ${fixture.safety.restartRecovery} | ${fixture.safety.exactBytesOracle} |`).join("\n");
  const outcome = report.decision.result === "skip-12"
    ? "完整 HTML 已达到预先固定的体验预算；取消第 12 项，继续第 13 项。"
    : "完整 HTML 未达到预先固定的体验预算；第 12-PR1（最小 full-HTML copy-path 优化）需要执行，12-PR2 仍未授权。";
  return `# 完整 HTML 持久化性能决策\n\n- 测量时间：${report.generatedAt}\n- Frozen main：\`${report.baseline.mainSha}\`（tree \`${report.baseline.treeSha}\`）\n- Harness commit：\`${report.harness.commitSha}\`\n- Renderer artifact：\`${report.build.rendererDigest}\`\n- Node / Electron：${report.machine.node} / ${report.machine.electron}\n- 机器：${report.machine.platform} ${report.machine.release} · ${report.machine.arch} · ${report.machine.cpu}\n- 样本：每个尺寸 ${report.options.samples} 个有效样本，${report.options.warmups} 个 warmup；所有操作串行执行。\n\n## 结论\n\n**${report.decision.result}** — ${outcome}\n\n## 端到端结果（毫秒，p50 / p95 / max）\n\n| HTML | Bridge transaction | Electron autosave（含 700ms debounce） | dirty switch | dirty close | clean close |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${rows}\n\n## 传输、内存与事件循环（p95）\n\n| HTML | request / response bytes | Bridge RSS delta MiB | renderer RSS delta MiB | renderer rAF gap ms | Bridge health-probe gap ms |\n| --- | ---: | ---: | ---: | ---: | ---: |\n${memoryRows}\n\nBridge health-probe gap 是对独立 Bridge 进程可服务性的外部观测，不把它伪称为内部 event-loop profiler。renderer rAF gap 来自真实隐藏 Electron 窗口，并显式关闭 background throttling。\n\n## 固定预算\n\n| 指标 | 实测 p95 | 预算 | 结果 |\n| --- | ---: | ---: | --- |\n${budgetRows}\n\n- Bridge warm RSS 严格单调增长：${report.decision.warmGrowth.map((growth) => `${growth.sizeMiB}MiB=${growth.strictMonotonicGrowth ? "yes" : "no"}`).join("；")}。\n\n## 安全 oracle\n\n| HTML | external-write conflict | restart recovery | exact source bytes |\n| --- | --- | --- | --- |\n${safetyRows}\n\n每个尺寸均用独立 synthetic HTML：正常 autosave 同时校验 request/response 字节、返回 Hash 与磁盘精确字节；额外运行外部写冲突和 \`save-source-written\` 重启恢复。未关闭 Hash/CAS、同目录原子替换、source-history、recovery 或 exact-byte oracle。\n\n## 复现\n\n从干净、已安装依赖的 checkout 运行：\n\n\`\`\`bash\nnpm run benchmark:persistence -- --samples ${report.options.samples} --warmups ${report.options.warmups} --report docs/PERSISTENCE_PERFORMANCE_DECISION.md\n\`\`\`\n\n命令只构建一次 Electron renderer，并在该固定 artifact 上依次运行 0.5MiB → 1.25MiB → 2.5MiB。它不改生产代码、不生成真实用户 HTML；完整原始结构化数据写入忽略的 \`output/persistence-performance/\`。\n`;
}

async function main() {
  const options = parseOptions();
  const rendererDirectory = path.join(productRoot, "dist-desktop");
  try {
    await readdir(rendererDirectory);
  } catch {
    throw new Error("Missing dist-desktop. Run this through npm run benchmark:persistence so the renderer is built once first.");
  }
  const temporaryParent = await realpath(os.tmpdir());
  const runRoot = await realpath(await mkdtemp(path.join(temporaryParent, tempPrefix)));
  try {
    const [mainSha, treeSha, harnessCommitSha, rendererDigest, viteConfig, electronVersion, changedFiles] = await Promise.all([
      gitValue("rev-parse", "origin/main"),
      gitValue("rev-parse", "origin/main^{tree}"),
      gitValue("rev-parse", "HEAD"),
      directoryDigest(rendererDirectory),
      readFile(path.join(productRoot, "desktop", "vite.config.ts"), "utf8").then(sha256),
      Promise.resolve(require("electron/package.json").version),
      options.report
        ? assertFrozenMainRuntimeInputs()
        : gitValue("diff", "--name-only", "origin/main").then((changed) => (
          changed.split("\n").filter(Boolean)
        )),
    ]);
    const fixtures = [];
    for (const sizeMiB of options.sizesMiB) {
      const bridge = await runBridgeSamples(runRoot, sizeMiB, options);
      const safety = await runSafetyChecks(runRoot, sizeMiB);
      const electronResults = await runElectronSamples(runRoot, sizeMiB, options);
      fixtures.push({ sizeMiB, bridge, safety, electron: electronResults });
    }
    const report = {
      generatedAt: new Date().toISOString(),
      options,
      baseline: { mainSha, treeSha },
      harness: { commitSha: harnessCommitSha, changedFiles },
      build: { rendererDigest, viteConfigSha256: viteConfig },
      machine: {
        platform: os.platform(),
        release: os.release(),
        arch: os.arch(),
        cpu: os.cpus()[0]?.model ?? "unknown",
        node: process.version,
        electron: electronVersion,
      },
      fixtures,
      decision: decisionFor(fixtures),
    };
    const outputDirectory = path.join(productRoot, "output", "persistence-performance");
    await mkdir(outputDirectory, { recursive: true });
    const jsonPath = path.join(outputDirectory, `${report.generatedAt.replaceAll(/[:.]/g, "-")}.json`);
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    const markdown = renderMarkdown(report);
    if (options.report) {
      const reportPath = path.resolve(productRoot, options.report);
      await mkdir(path.dirname(reportPath), { recursive: true });
      await writeFile(reportPath, markdown, "utf8");
    }
    process.stdout.write(`${markdown}\nRaw evidence: ${jsonPath}\n`);
  } finally {
    const resolved = path.resolve(runRoot);
    assert(path.dirname(resolved) === temporaryParent && path.basename(resolved).startsWith(tempPrefix), "Refusing to remove an unexpected benchmark directory.");
    await rm(resolved, { recursive: true, force: true });
  }
}

await main();

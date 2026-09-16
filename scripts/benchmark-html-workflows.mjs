import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "playwright";

import {
  launchStemmio,
  openRailGlobalCommentComposer,
  stopStemmio,
} from "../tests/e2e/electron/helpers/stemmio-app-fixture.mjs";
import { currentEditorFrame } from "../tests/e2e/browser/stemmio-driver.mjs";
import {
  chooseClipboardDelivery,
  runOfficialFinalizer,
  writeAiOutput,
} from "../tests/e2e/electron/ai-closed-loop-helpers.mjs";

function commandLineOptions(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for --${key}.`);
    }
    parsed[key] = value;
    index += 1;
  }
  return parsed;
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = commandLineOptions(process.argv.slice(2));
const outputRoot = path.resolve(
  options.output || path.join(root, "output", "html-workflow-benchmark"),
);
const screenshotsRoot = path.join(outputRoot, "screenshots");
const sourceRoot = path.resolve(
  options["html-dir"] || "/Users/lizexuan/Documents/Stemmio/测试用HTML",
);
const appPath = path.resolve(options.app || path.join(
  root,
  "output/developer-preview/release/mac-arm64/Stemmio Developer Preview.app",
));
const appExecutableName = path.basename(appPath, ".app");
const executablePath = path.join(
  appPath,
  "Contents/MacOS",
  appExecutableName,
);
const qaToken = "【Stemmio 性能测试编辑】";
const reviewMarker = "Stemmio-Real-HTML-Review-Performance-Marker";
const results = {
  schemaVersion: 3,
  startedAt: new Date().toISOString(),
  sourceCommit: options.commit || execFileSync(
    "git",
    ["rev-parse", "HEAD"],
    { cwd: root, encoding: "utf8" },
  ).trim(),
  label: options.label || null,
  appPath,
  sourceRoot,
  machine: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  },
  sources: [],
  opening: [],
  editing: {},
  preview: {},
  switching: {},
  cacheBudget: {},
  review: {},
  acceptThenOpen: {},
  memory: [],
  faults: {
    pageErrors: { count: 0, samples: [] },
    consoleErrors: { count: 0, samples: [] },
    crashes: 0,
  },
};

mkdirSync(screenshotsRoot, { recursive: true });
assert(existsSync(executablePath), `Packaged app executable not found: ${executablePath}`);
assert(existsSync(sourceRoot), `HTML fixture directory not found: ${sourceRoot}`);

function round(value) {
  return Math.round(value * 10) / 10;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]);
}

function summarize(values) {
  return {
    count: values.length,
    minMs: values.length ? round(Math.min(...values)) : null,
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    maxMs: values.length ? round(Math.max(...values)) : null,
  };
}

async function rendererPerformanceTimeline(since = 0) {
  return launched.page.evaluate((minimumStartTime) => ({
    timeOriginUnixMs: performance.timeOrigin,
    marks: performance.getEntriesByType("mark")
      .filter((entry) => entry.name.startsWith("stemmio:"))
      .filter((entry) => entry.startTime >= minimumStartTime)
      .map((entry) => ({
        name: entry.name,
        startTime: entry.startTime,
        detail: entry.detail && typeof entry.detail === "object"
          ? JSON.parse(JSON.stringify(entry.detail))
          : null,
      })),
    hydration: (window.__STEMMIO_PERFORMANCE_TIMELINE__ || [])
      .filter((entry) => entry.startTime >= minimumStartTime)
      .map((entry) => JSON.parse(JSON.stringify(entry))),
  }), since);
}

async function waitUntil(check, {
  timeout = 30_000,
  interval = 25,
  label = "condition",
} = {}) {
  const deadline = performance.now() + timeout;
  let lastError = null;
  while (performance.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  throw new Error(`Timed out waiting for ${label}.${lastError ? ` Last error: ${lastError.message}` : ""}`);
}

function listRealHtml() {
  return readdirSync(sourceRoot)
    .filter((name) => /\.html?$/iu.test(name))
    .map((name) => path.join(sourceRoot, name))
    .sort((left, right) => statSync(right).size - statSync(left).size);
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function withoutStableIdentity(html) {
  return String(html).replace(
    /\sdata-stemmio-id="sm1_[a-f0-9]{32}"/gu,
    "",
  );
}

function expectsRenderedChart(sourceBytes) {
  return /<canvas\b|<svg\b|\becharts\b|\bcreateElementNS\b|\bnew\s+Chart\b/iu.test(
    String(sourceBytes || ""),
  );
}

const realSources = listRealHtml();
assert(realSources.length >= 2, "At least two real HTML files are required.");
results.sources = realSources.map((filePath) => ({
  fileName: path.basename(filePath),
  bytes: statSync(filePath).size,
  sha256: sha256(filePath),
  expectsRenderedChart: expectsRenderedChart(readFileSync(filePath, "utf8")),
}));

const copiedSourceRoot = mkdtempSync(path.join(tmpdir(), "stemmio-native-e2e-htmlperf-source-"));
const copiedSources = Array.from({ length: 21 }, (_, index) => {
  const original = realSources[index % realSources.length];
  const extension = path.extname(original);
  const stem = path.basename(original, extension);
  const copyPath = path.join(
    copiedSourceRoot,
    `${String(index + 1).padStart(2, "0")}-${stem}${extension}`,
  );
  copyFileSync(original, copyPath);
  return { original, copyPath, stem: path.basename(copyPath, extension) };
});

const packagedLauncher = (options) => electron.launch({
  ...options,
  executablePath,
  args: options.args.slice(1),
});

let launched = null;

async function rendererMemory(label) {
  const processMetrics = await launched.electronApp.evaluate(({ app }) => (
    app.getAppMetrics().map((metric) => ({
      pid: metric.pid,
      type: metric.type,
      workingSetKb: metric.memory?.workingSetSize || 0,
      peakWorkingSetKb: metric.memory?.peakWorkingSetSize || 0,
    }))
  ));
  const renderer = await launched.page.evaluate(() => ({
    usedJsHeapBytes: performance.memory?.usedJSHeapSize || null,
    totalJsHeapBytes: performance.memory?.totalJSHeapSize || null,
    longTasks: Array.isArray(window.__qaLongTasks) ? window.__qaLongTasks.length : null,
    longTaskDurationMs: Array.isArray(window.__qaLongTasks)
      ? window.__qaLongTasks.reduce((sum, task) => sum + task.duration, 0)
      : null,
    iframeAdds: Number(window.__qaIframeAdds || 0),
    iframeRemoves: Number(window.__qaIframeRemoves || 0),
  }));
  const resources = await runtimeResourceSnapshot();
  const charts = await chartCompletenessSnapshot();
  const totalWorkingSetMb = processMetrics.reduce(
    (sum, metric) => sum + metric.workingSetKb,
    0,
  ) / 1024;
  const totalPeakWorkingSetMb = processMetrics.reduce(
    (sum, metric) => sum + metric.peakWorkingSetKb,
    0,
  ) / 1024;
  const snapshot = {
    label,
    totalWorkingSetMb: round(totalWorkingSetMb),
    totalPeakWorkingSetMb: round(totalPeakWorkingSetMb),
    processCount: processMetrics.length,
    renderer,
    processMetrics,
    resources,
    charts,
    faults: {
      pageErrors: results.faults.pageErrors.count,
      consoleErrors: results.faults.consoleErrors.count,
      crashes: results.faults.crashes,
    },
  };
  results.memory.push(snapshot);
  return snapshot;
}

async function activeProject() {
  return launched.page.evaluate(() => window.stemmioProjects?.getActiveProject());
}

async function activeContentReady({ expectedStem = "", timeout = 45_000 } = {}) {
  if (expectedStem) {
    await waitUntil(async () => {
      const project = await activeProject();
      return project?.sourcePath && path.basename(project.sourcePath).includes(expectedStem);
    }, { timeout, label: `active project ${expectedStem}` });
  }
  const editor = launched.page.getByTestId("html-canvas-editor")
    .filter({ visible: true })
    .first();
  await editor.waitFor({ state: "visible", timeout });
  const iframe = editor.locator('iframe[title*="HTML"]').first();
  await iframe.waitFor({ state: "attached", timeout });
  await waitUntil(async () => {
    const handle = await iframe.elementHandle();
    const frame = await handle?.contentFrame();
    if (!frame || frame.isDetached()) return false;
    return frame.locator("body").evaluate((body) => (
      body.getClientRects().length > 0 && (body.innerText || body.textContent || "").trim().length > 20
    ));
  }, { timeout, label: `visible HTML content ${expectedStem}` });
  return { editor, iframe };
}

async function firstUsefulDocumentVisible({ expectedStem = "", timeout = 45_000 } = {}) {
  if (expectedStem) {
    await waitUntil(async () => {
      const project = await activeProject();
      return project?.sourcePath && path.basename(project.sourcePath).includes(expectedStem);
    }, { timeout, label: `active project display ${expectedStem}` });
  }
  await waitUntil(async () => {
    const display = launched.page.getByTestId("html-display-surface")
      .filter({ visible: true })
      .first();
    if (
      await display.isVisible().catch(() => false)
      && await display.getAttribute("data-display-ready", { timeout: 50 })
        .catch(() => null) === "true"
    ) return true;
    const editor = launched.page.getByTestId("html-canvas-editor")
      .filter({ visible: true })
      .first();
    if (!await editor.isVisible().catch(() => false)) return false;
    if (
      await editor.getAttribute("data-render-verified", { timeout: 50 })
        .catch(() => null) === "true"
    ) {
      return true;
    }
    const iframe = editor.locator('iframe[title*="HTML"]').first();
    if (await iframe.count() < 1) return false;
    const handle = await iframe.elementHandle({ timeout: 50 }).catch(() => null);
    const frame = await handle?.contentFrame();
    if (!frame || frame.isDetached()) return false;
    return frame.locator("body").evaluate((body) => (
      body.getClientRects().length > 0
      && (body.innerText || body.textContent || "").trim().length > 20
    )).catch(() => false);
  }, { timeout, label: `first useful document visible ${expectedStem}` });
}

async function finishActiveReadiness(editor, timeout = 45_000) {
  await waitUntil(
    () => editor.getAttribute("data-render-verified").then((value) => value === "true"),
    { timeout, label: "render verification" },
  );
  await waitUntil(
    () => launched.page.locator("main.workbench").getAttribute("data-project-state")
      .then((value) => value === "ready"),
    { timeout, label: "project ready" },
  );
}

async function renderedSnapshot(frame) {
  return frame.locator("html").evaluate(() => {
    const visibleRect = (element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return style.display !== "none"
        && style.visibility !== "hidden"
        && rect.width >= 40
        && rect.height >= 24;
    };
    const canvasFacts = [...document.querySelectorAll("canvas")]
      .filter(visibleRect)
      .filter((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return rect.width >= 120 && rect.height >= 60;
      })
      .map((canvas) => {
        let ready = false;
        let signature = "unreadable";
        try {
          const sample = document.createElement("canvas");
          sample.width = 32;
          sample.height = 32;
          const context = sample.getContext("2d", { willReadFrequently: true });
          context.drawImage(canvas, 0, 0, 32, 32);
          const pixels = context.getImageData(0, 0, 32, 32).data;
          const colors = new Set();
          let opaque = 0;
          let rolling = 2166136261;
          for (let offset = 0; offset < pixels.length; offset += 4) {
            const red = pixels[offset];
            const green = pixels[offset + 1];
            const blue = pixels[offset + 2];
            const alpha = pixels[offset + 3];
            if (alpha > 8) opaque += 1;
            colors.add(`${red >> 4}:${green >> 4}:${blue >> 4}:${alpha >> 4}`);
            rolling ^= red + (green << 8) + (blue << 16) + alpha;
            rolling = Math.imul(rolling, 16777619) >>> 0;
          }
          ready = opaque > 8 && colors.size > 2;
          signature = `${opaque}:${colors.size}:${rolling}`;
        } catch {
          const rect = canvas.getBoundingClientRect();
          ready = canvas.width > 0 && canvas.height > 0 && rect.width > 0 && rect.height > 0;
          signature = `opaque-or-webgl:${canvas.width}x${canvas.height}`;
        }
        return { ready, signature, width: canvas.width, height: canvas.height };
      });
    const svgFacts = [...document.querySelectorAll("svg")]
      // Review draws its own full-page masks and annotation outlines as SVG.
      // They are UI chrome, not authored charts, and waiting for their empty
      // transition shells made a fully visible page look unfinished forever.
      .filter((svg) => !svg.closest(
        "[data-stemmio-review-projection-layer], [data-stemmio-review-transition-mask]",
      ) && !svg.matches(
        "[data-stemmio-review-mask-layer], [data-stemmio-review-overlay-shape-svg]",
      ))
      .filter(visibleRect)
      .filter((svg) => {
        const rect = svg.getBoundingClientRect();
        const chartish = /chart|graph|plot|echart/iu.test(
          `${svg.id} ${svg.getAttribute("class") || ""} ${svg.parentElement?.id || ""} ${svg.parentElement?.getAttribute("class") || ""}`,
        );
        return chartish || (rect.width >= 180 && rect.height >= 90);
      })
      .map((svg) => {
        const marks = svg.querySelectorAll("path,rect,circle,line,polyline,polygon,text");
        return { ready: marks.length >= 3, signature: `${marks.length}:${svg.innerHTML.length}` };
      });
    const chartContainers = [...document.querySelectorAll('[_echarts_instance_]')]
      .filter(visibleRect)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 120 && rect.height >= 60;
      })
      .map((element) => ({
        ready: element.childElementCount > 0 || (element.textContent || "").trim().length > 0,
        signature: `${element.childElementCount}:${element.innerHTML.length}`,
      }));
    const runtimeVisualHosts = [...document.querySelectorAll(
      "[data-stemmio-edit-runtime-host]",
    )]
      .filter(visibleRect)
      .map((element) => {
        const ownedNodes = element.querySelectorAll(
          "[data-stemmio-edit-runtime-owned]",
        ).length;
        return {
          ready: ownedNodes > 0,
          signature: `${ownedNodes}:${element.innerHTML.length}`,
        };
      })
      .filter((fact) => fact.ready);
    const chartFacts = [
      ...canvasFacts,
      ...svgFacts,
      ...chartContainers,
      ...runtimeVisualHosts,
    ];
    const body = document.body;
    return {
      readyState: document.readyState,
      textLength: (body?.innerText || body?.textContent || "").trim().length,
      bodyHeight: Math.max(
        document.documentElement.scrollHeight,
        body?.scrollHeight || 0,
        body?.getBoundingClientRect().height || 0,
      ),
      chartCount: chartFacts.length,
      readyChartCount: chartFacts.filter((fact) => fact.ready).length,
      chartSignature: chartFacts.map((fact) => fact.signature).join("|"),
      canvasCount: canvasFacts.length,
      svgChartCount: svgFacts.length,
      chartContainerCount: chartContainers.length,
      runtimeVisualHostCount: runtimeVisualHosts.length,
    };
  });
}

async function runtimeResourceSnapshot() {
  return launched.page.evaluate(() => {
    const surfaceCache = document.querySelector(
      '[data-testid="workbench-document-surface-cache"]',
    );
    const runtimePool = document.querySelector(
      '[data-testid="workbench-active-document-canvas"]',
    );
    const reviewWorkspace = document.querySelector('[data-testid="ai-review-workspace"]');
    const numberAttribute = (element, name) => Number(element?.getAttribute(name) || 0);
    return {
      iframeCount: document.querySelectorAll("iframe").length,
      review: {
        mounted: Boolean(reviewWorkspace),
        iframeCount: reviewWorkspace?.querySelectorAll("iframe").length || 0,
      },
      documentSurfaceCache: {
        mounted: Boolean(surfaceCache),
        surfaceCount: surfaceCache?.querySelectorAll("[data-tab-id]").length || 0,
        iframeCount: surfaceCache?.querySelectorAll("iframe").length || 0,
        mountedCount: numberAttribute(surfaceCache, "data-mounted-count"),
        cacheEntryCount: numberAttribute(surfaceCache, "data-cache-entry-count"),
        presentationCount: numberAttribute(surfaceCache, "data-presentation-count"),
        cachedBytes: numberAttribute(surfaceCache, "data-cache-bytes"),
      },
      runtimeHot: {
        count: numberAttribute(runtimePool, "data-runtime-hot-count"),
        limit: numberAttribute(runtimePool, "data-runtime-hot-limit"),
        iframeCount: runtimePool?.querySelectorAll("iframe").length || 0,
      },
    };
  });
}

async function chartCompletenessSnapshot() {
  const pages = [];
  const capture = async (label, frame) => {
    try {
      const snapshot = await renderedSnapshot(frame);
      pages.push({
        label,
        chartCount: snapshot.chartCount,
        readyChartCount: snapshot.readyChartCount,
        complete: snapshot.chartCount === 0
          || snapshot.readyChartCount === snapshot.chartCount,
        renderFacts: snapshot,
      });
    } catch (error) {
      pages.push({
        label,
        chartCount: null,
        readyChartCount: null,
        complete: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
  const reviewWorkspace = launched.page.getByTestId("ai-review-workspace");
  if (await reviewWorkspace.count() > 0) {
    await Promise.all([
      capture("review-before", launched.page.frameLocator('iframe[title^="修改前"]')),
      capture("review-after", launched.page.frameLocator('iframe[title^="修改后"]')),
    ]);
  } else {
    const editor = launched.page.getByTestId("html-canvas-editor")
      .filter({ visible: true })
      .first();
    const editorFrame = editor.locator('iframe[title*="HTML"]');
    if (await editor.count() > 0 && await editorFrame.count() > 0) {
      try {
        await capture("active-editor", await currentEditorFrame(launched.page));
      } catch {
        // A launch checkpoint can legitimately have no authored document yet.
      }
    }
  }
  return {
    pageCount: pages.length,
    completePageCount: pages.filter((page) => page.complete).length,
    incompletePages: pages.filter((page) => !page.complete),
    pages,
  };
}

async function waitForRenderedContent(frameResolver, started, {
  timeout = 20_000,
  label = "rendered content",
  expectCharts = false,
} = {}) {
  const deadline = performance.now() + timeout;
  let firstTextMs = null;
  let firstAllChartsMs = null;
  let stableReadySamples = 0;
  let priorHeight = null;
  let priorSignature = null;
  let signatureStableSamples = 0;
  let finalSnapshot = null;
  while (performance.now() < deadline) {
    try {
      const frame = await frameResolver();
      const snapshot = await renderedSnapshot(frame);
      finalSnapshot = snapshot;
      if (snapshot.textLength > 20 && firstTextMs === null) {
        firstTextMs = performance.now() - started;
      }
      const chartPresenceReady = !expectCharts || snapshot.chartCount > 0;
      const allChartsReady = chartPresenceReady && (
        snapshot.chartCount === 0 || snapshot.readyChartCount === snapshot.chartCount
      );
      if (snapshot.chartCount > 0 && allChartsReady && firstAllChartsMs === null) {
        firstAllChartsMs = performance.now() - started;
      }
      const heightStable = priorHeight !== null && Math.abs(snapshot.bodyHeight - priorHeight) < 1;
      stableReadySamples = snapshot.readyState === "complete"
        && snapshot.textLength > 20
        && allChartsReady
        && heightStable
        ? stableReadySamples + 1
        : 0;
      signatureStableSamples = priorSignature !== null
        && priorSignature === snapshot.chartSignature
        ? signatureStableSamples + 1
        : 0;
      priorHeight = snapshot.bodyHeight;
      priorSignature = snapshot.chartSignature;
      if (stableReadySamples >= 3) {
        return {
          textVisibleMs: firstTextMs === null ? null : round(firstTextMs),
          allChartsReadyMs: firstAllChartsMs === null ? null : round(firstAllChartsMs),
          fullContentReadyMs: round(performance.now() - started),
          chartSignatureStable: snapshot.chartCount === 0 || signatureStableSamples >= 2,
          expectCharts,
          snapshot,
        };
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return {
    textVisibleMs: firstTextMs === null ? null : round(firstTextMs),
    allChartsReadyMs: firstAllChartsMs === null ? null : round(firstAllChartsMs),
    fullContentReadyMs: null,
    observationMs: round(performance.now() - started),
    timedOut: true,
    chartSignatureStable: false,
    expectCharts,
    label,
    snapshot: finalSnapshot,
  };
}

async function openThroughInput(source, ordinal) {
  const beforeTabs = await launched.page.getByRole("tablist", { name: "已打开的页面" })
    .getByRole("tab").count();
  const started = performance.now();
  const rendererStartedAt = await launched.page.evaluate(() => performance.now());
  await launched.electronApp.evaluate(({ dialog }, sourcePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourcePath] });
  }, source.copyPath);
  const openTrigger = await requestLocalHtmlOpen(launched.page);
  console.log("OPEN_TRIGGER", openTrigger);
  const openLocalButton = launched.page.locator(".open-local-button");
  let pendingImport = await waitUntil(async () => {
    if (await openLocalButton.isVisible().catch(() => false)) return "picker";
    const project = await activeProject();
    if (project?.sourcePath && path.basename(project.sourcePath).includes(source.stem)) return "opened";
    return "";
  }, { timeout: 15_000, label: `open handoff ${source.stem}` });
  if (pendingImport === "picker") {
    await openLocalButton.click();
    pendingImport = await waitUntil(async () => {
      const project = await activeProject();
      if (project?.sourcePath && path.basename(project.sourcePath).includes(source.stem)) return "opened";
      return "";
    }, { timeout: 15_000, label: `picker handoff ${source.stem}` });
  }
  const displayReadyPromise = firstUsefulDocumentVisible({ expectedStem: source.stem })
    .then(() => performance.now() - started);
  const editorReadyPromise = activeContentReady({ expectedStem: source.stem })
    .then((value) => ({ ...value, editReadyMs: performance.now() - started }));
  const [displayReadyMs, { editor, editReadyMs }] = await Promise.all([
    displayReadyPromise,
    editorReadyPromise,
  ]);
  const renderedPromise = waitForRenderedContent(
    () => currentEditorFrame(launched.page),
    started,
    {
      label: `full HTML and charts ${source.stem}`,
      expectCharts: expectsRenderedChart(readFileSync(source.original, "utf8")),
    },
  );
  const tabCountPromise = waitUntil(async () => (
    await launched.page.getByRole("tablist", { name: "已打开的页面" })
      .getByRole("tab").count()
  ) >= Math.min(ordinal, beforeTabs + 1), {
    timeout: 45_000,
    label: `tab count after ${source.stem}`,
  });
  const verifiedPromise = waitUntil(
    () => editor.getAttribute("data-render-verified").then((value) => value === "true"),
    { timeout: 45_000, label: `verification ${source.stem}` },
  ).then(() => performance.now() - started);
  const readyPromise = waitUntil(
    () => launched.page.locator("main.workbench").getAttribute("data-project-state")
      .then((value) => value === "ready"),
    { timeout: 45_000, label: `ready ${source.stem}` },
  ).then(() => performance.now() - started);
  const [rendered, verifiedMs, readyMs] = await Promise.all([
    renderedPromise,
    verifiedPromise,
    readyPromise,
    tabCountPromise,
  ]);
  const project = await activeProject();
  const sample = {
    ordinal,
    fileName: path.basename(source.original),
    sourceBytes: statSync(source.original).size,
    visibleMs: round(displayReadyMs),
    displayReadyMs: round(displayReadyMs),
    editReadyMs: round(editReadyMs),
    textVisibleMs: rendered.textVisibleMs,
    allChartsReadyMs: rendered.allChartsReadyMs,
    fullContentReadyMs: rendered.fullContentReadyMs,
    renderFacts: rendered.snapshot,
    verifiedMs: round(verifiedMs),
    readyMs: round(readyMs),
    activeSourcePath: project.sourcePath,
    tabCount: await launched.page.getByRole("tablist", { name: "已打开的页面" })
      .getByRole("tab").count(),
    performanceTimeline: await rendererPerformanceTimeline(rendererStartedAt),
  };
  results.opening.push(sample);
  console.log("OPEN", JSON.stringify({
    ordinal: sample.ordinal,
    fileName: sample.fileName,
    visibleMs: sample.visibleMs,
    displayReadyMs: sample.displayReadyMs,
    editReadyMs: sample.editReadyMs,
    textVisibleMs: sample.textVisibleMs,
    allChartsReadyMs: sample.allChartsReadyMs,
    fullContentReadyMs: sample.fullContentReadyMs,
    verifiedMs: sample.verifiedMs,
    readyMs: sample.readyMs,
    tabCount: sample.tabCount,
  }));
  return sample;
}

async function requestLocalHtmlOpen(page) {
  // The packaged shell can publish its Desktop bridge while the built-in
  // welcome project is still opening. Starting a second open operation in that
  // transient Start tab is rejected by the project workflow. Wait for the
  // current project boundary, then allow the capability effect and its state
  // update to settle before exercising the next user-visible open action.
  await waitUntil(
    () => page.locator("main.workbench").getAttribute("data-project-state")
      .then((value) => value === "ready"),
    { timeout: 45_000, label: "current project before local open" },
  );
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const startCreateProject = page.locator(".workbench-start-page")
    .getByRole("button", { name: "新建项目", exact: true })
    .first();
  if (await startCreateProject.isVisible().catch(() => false)) {
    await startCreateProject.click();
    return "start-new-project";
  }
  const sidebarCreateProject = page.locator(".workbench-global-sidebar")
    .getByRole("button", { name: "新建项目", exact: true })
    .first();
  if (await sidebarCreateProject.isVisible().catch(() => false)) {
    await sidebarCreateProject.click();
    return "sidebar-new-project";
  }
  const legacy = page.getByRole("button", { name: "打开新的本地 HTML", exact: true });
  if (await legacy.isVisible().catch(() => false)) {
    await legacy.click();
    return "legacy-open-local";
  }
  const startPage = page.getByRole("button", { name: "从 Finder 打开 HTML", exact: true });
  if (await startPage.isVisible().catch(() => false)) {
    await startPage.click();
    return "legacy-start-finder";
  }
  const expandSidebar = page.getByRole("button", { name: "展开左侧边栏", exact: true });
  if (await expandSidebar.isVisible().catch(() => false)) await expandSidebar.click();
  await page.locator(".workbench-global-sidebar")
    .getByRole("button", { name: "新建项目", exact: true })
    .click();
  return "expanded-sidebar-new-project";
}

async function cacheState() {
  return launched.page.evaluate(() => {
    const root = document.querySelector('[data-testid="workbench-document-surface-cache"]');
    const runtimePool = document.querySelector('[data-testid="workbench-active-document-canvas"]');
    const numberAttribute = (name) => Number(root?.getAttribute(name) || 0);
    return {
      surfaceCount: root?.querySelectorAll("[data-tab-id]").length || 0,
      iframeCount: root?.querySelectorAll("iframe").length || 0,
      mountedTabIds: [...(root?.querySelectorAll("[data-tab-id]") || [])]
        .map((entry) => entry.getAttribute("data-tab-id")),
      visible: root?.getAttribute("data-visible") || null,
      visibleTabId: root?.getAttribute("data-visible-tab-id") || null,
      mountedCount: numberAttribute("data-mounted-count"),
      cacheEntryCount: numberAttribute("data-cache-entry-count"),
      presentationCount: numberAttribute("data-presentation-count"),
      coldCount: numberAttribute("data-cold-count"),
      cachedBytes: numberAttribute("data-cache-bytes"),
      limits: {
        maxEntries: numberAttribute("data-max-cache-entries"),
        maxBytes: numberAttribute("data-max-cache-bytes"),
      },
      runtimeHot: {
        count: Number(runtimePool?.getAttribute("data-runtime-hot-count") || 0),
        limit: Number(runtimePool?.getAttribute("data-runtime-hot-limit") || 0),
        iframeCount: runtimePool?.querySelectorAll("iframe").length || 0,
      },
    };
  });
}

function assertCacheBudget(snapshot, label, { minimumRuntimeHotCount = 0 } = {}) {
  assert(snapshot.limits.maxEntries > 0, `${label}: cache diagnostics are missing`);
  assert.equal(snapshot.surfaceCount, snapshot.mountedCount, `${label}: handoff DOM count drifted`);
  assert.equal(snapshot.iframeCount, snapshot.mountedCount, `${label}: handoff iframe count drifted`);
  assert(
    snapshot.mountedCount <= 2,
    `${label}: transient handoff surfaces exceeded the overlap budget`,
  );
  assert(
    snapshot.cacheEntryCount <= snapshot.limits.maxEntries,
    `${label}: retained projections exceeded the entry budget`,
  );
  assert(
    snapshot.cachedBytes <= snapshot.limits.maxBytes,
    `${label}: retained projections exceeded the byte budget`,
  );
  assert(
    snapshot.runtimeHot.count <= snapshot.runtimeHot.limit,
    `${label}: active runtime canvases exceeded the resource budget`,
  );
  assert(
    snapshot.runtimeHot.count >= minimumRuntimeHotCount,
    `${label}: active runtime canvases fell below the ${minimumRuntimeHotCount}-canvas floor`,
  );
  assert(
    snapshot.runtimeHot.iframeCount >= snapshot.runtimeHot.count
      && snapshot.runtimeHot.iframeCount <= snapshot.runtimeHot.count * 2,
    `${label}: retained runtime iframe count escaped the PR 415 dual-slot bound`,
  );
}

function assertReviewResourcesReleased(snapshot) {
  assert.equal(
    snapshot.resources.review.mounted,
    false,
    "accept: Review workspace remained mounted after adoption",
  );
  assert.equal(
    snapshot.resources.review.iframeCount,
    0,
    "accept: Review iframes remained mounted after adoption",
  );
  assert(
    snapshot.resources.runtimeHot.count <= snapshot.resources.runtimeHot.limit,
    "accept: more than one active runtime canvas remained mounted",
  );
  assert(
    snapshot.resources.runtimeHot.count >= 1,
    "accept: adoption did not restore the active runtime canvas",
  );
}

async function switchTo(index) {
  const tabs = launched.page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
  const tab = tabs.nth(index);
  const label = (await tab.innerText()).trim();
  const tabId = String(await tab.getAttribute("id") || "").replace(/^workbench-tab-/u, "");
  const beforeAdds = await launched.page.evaluate(() => Number(window.__qaIframeAdds || 0));
  const beforeRemoves = await launched.page.evaluate(() => Number(window.__qaIframeRemoves || 0));
  const cacheTimelineStartedAt = await launched.page.evaluate(() => performance.now());
  const started = performance.now();
  await tab.click();
  await waitUntil(
    () => tab.getAttribute("aria-selected").then((value) => value === "true"),
    { timeout: 45_000, label: `selected tab ${index}` },
  );
  const expectedStem = path.basename(label, path.extname(label));
  await activeContentReady({ expectedStem, timeout: 45_000 });
  const switchedProject = await activeProject();
  const switchExpectsCharts = expectsRenderedChart(
    readFileSync(switchedProject.sourcePath, "utf8"),
  );
  const rendered = await waitForRenderedContent(
    () => currentEditorFrame(launched.page),
    started,
    {
      label: `tab ${index} full HTML and charts`,
      timeout: 8_000,
      expectCharts: switchExpectsCharts,
    },
  );
  const elapsedMs = rendered.fullContentReadyMs ?? rendered.observationMs;
  const afterAdds = await launched.page.evaluate(() => Number(window.__qaIframeAdds || 0));
  const afterRemoves = await launched.page.evaluate(() => Number(window.__qaIframeRemoves || 0));
  const cacheHandoff = await launched.page.evaluate(({ minimumStartTime, expectedTabId }) => {
    const matching = (name) => performance.getEntriesByName(name, "mark")
      .filter((entry) => entry.startTime >= minimumStartTime)
      .find((entry) => entry.detail?.tabId === expectedTabId);
    const visible = matching("stemmio:tab-cache:visible-ready");
    const scrollable = matching("stemmio:tab-cache:scrollable-ready");
    const completed = matching("stemmio:tab-cache:handoff-complete");
    const runtimeHot = matching("stemmio:runtime-hot:visible-ready");
    return {
      visibleReadyMs: visible ? visible.startTime - minimumStartTime : null,
      scrollableReadyMs: scrollable ? scrollable.startTime - minimumStartTime : null,
      handoffCompleteMs: completed ? completed.startTime - minimumStartTime : null,
      runtimeHotReadyMs: runtimeHot ? runtimeHot.startTime - minimumStartTime : null,
    };
  }, { minimumStartTime: cacheTimelineStartedAt, expectedTabId: tabId });
  return {
    index,
    label,
    elapsedMs: round(elapsedMs),
    textVisibleMs: rendered.textVisibleMs,
    allChartsReadyMs: rendered.allChartsReadyMs,
    renderFacts: rendered.snapshot,
    cachedDisplayReadyMs: cacheHandoff.visibleReadyMs === null
      ? null
      : round(cacheHandoff.visibleReadyMs),
    cachedScrollableReadyMs: cacheHandoff.scrollableReadyMs === null
      ? null
      : round(cacheHandoff.scrollableReadyMs),
    cacheHandoffCompleteMs: cacheHandoff.handoffCompleteMs === null
      ? null
      : round(cacheHandoff.handoffCompleteMs),
    runtimeHotReadyMs: cacheHandoff.runtimeHotReadyMs === null
      ? null
      : round(cacheHandoff.runtimeHotReadyMs),
    iframeAdds: afterAdds - beforeAdds,
    iframeRemoves: afterRemoves - beforeRemoves,
  };
}

async function runSwitchBatch(label, indices) {
  const samples = [];
  for (const index of indices) samples.push(await switchTo(index));
  const elapsed = samples.map((sample) => sample.elapsedMs);
  const summary = {
    ...summarize(elapsed),
    cachedDisplayReady: summarize(samples
      .map((sample) => sample.cachedDisplayReadyMs)
      .filter((value) => value !== null)),
    cachedScrollableReady: summarize(samples
      .map((sample) => sample.cachedScrollableReadyMs)
      .filter((value) => value !== null)),
    cacheHandoffComplete: summarize(samples
      .map((sample) => sample.cacheHandoffCompleteMs)
      .filter((value) => value !== null)),
    runtimeHotReady: summarize(samples
      .map((sample) => sample.runtimeHotReadyMs)
      .filter((value) => value !== null)),
    iframeAdds: samples.reduce((sum, sample) => sum + sample.iframeAdds, 0),
    iframeRemoves: samples.reduce((sum, sample) => sum + sample.iframeRemoves, 0),
    cache: await cacheState(),
    samples,
  };
  results.switching[label] = summary;
  console.log("SWITCH", label, JSON.stringify(summary));
  return summary;
}

async function exerciseEditAndPreview() {
  const page = launched.page;
  const editButton = page.getByRole("button", { name: "编辑", exact: true });
  if (await editButton.isVisible().catch(() => false)) await editButton.click();
  const frame = await currentEditorFrame(page);
  const target = frame.locator(".hero-lede").first();
  await target.scrollIntoViewIfNeeded();
  const activateStarted = performance.now();
  await target.dblclick({ position: { x: 40, y: 12 } });
  await waitUntil(() => target.evaluate((element) => (
    element.isContentEditable && document.activeElement === element
  )), { timeout: 10_000, label: "native edit activation" });
  results.editing.activateMs = round(performance.now() - activateStarted);
  await target.evaluate((element) => {
    const selection = document.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  });
  const projectBeforeSave = await activeProject();
  const saveStarted = performance.now();
  await page.keyboard.insertText(qaToken);
  await page.keyboard.press("Meta+S");
  await waitUntil(
    () => readFileSync(projectBeforeSave.sourcePath, "utf8").includes(qaToken),
    { timeout: 30_000, label: "edited source persistence" },
  );
  results.editing.saveMs = round(performance.now() - saveStarted);
  results.editing.sourcePath = projectBeforeSave.sourcePath;
  await page.screenshot({
    path: path.join(screenshotsRoot, "01-edit-real-html.png"),
    animations: "disabled",
  });

  const previewStarted = performance.now();
  await page.getByRole("button", { name: "预览", exact: true }).click();
  const previewFrame = page.frameLocator('iframe[title="HTML 交互预览"]');
  await waitUntil(
    () => previewFrame.locator("body").evaluate(
      (body, token) => body.innerText.includes(token),
      qaToken,
    ),
    { timeout: 30_000, label: "interactive preview content" },
  );
  results.preview.openMs = round(performance.now() - previewStarted);
  results.preview.rendered = await waitForRenderedContent(
    () => previewFrame,
    previewStarted,
    { label: "interactive preview full HTML and charts", expectCharts: true },
  );
  await page.screenshot({
    path: path.join(screenshotsRoot, "02-preview-real-html.png"),
    animations: "disabled",
  });
  const editReturnStarted = performance.now();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  await waitUntil(async () => {
    const current = await currentEditorFrame(page);
    return current.locator("body").evaluate(
      (body, token) => body.innerText.includes(token),
      qaToken,
    );
  }, { timeout: 30_000, label: "edit mode return" });
  results.preview.returnToEditMs = round(performance.now() - editReturnStarted);
}

async function createRealReviewCandidate() {
  const page = launched.page;
  await launched.electronApp.evaluate(({ clipboard }) => clipboard.clear());
  await openRailGlobalCommentComposer(page);
  const instruction = "在页面顶部新增一个简洁的性能测试标记，其他内容保持不变。";
  await page.getByRole("textbox", { name: "评论内容" }).fill(instruction);
  await page.getByRole("button", { name: "评论", exact: true }).click();
  await waitUntil(
    () => page.locator(".comment-card").filter({ hasText: instruction }).count(),
    { timeout: 45_000, label: "global review comment" },
  );
  await page.getByRole("button", { name: /AI 助手/u }).click();
  await chooseClipboardDelivery(page);
  let promptPath = "";
  await waitUntil(async () => {
    const copied = await launched.electronApp.evaluate(({ clipboard }) => clipboard.readText());
    promptPath = copied.match(/请执行\s+(.+?\/PROMPT\.md)\s+中的单轮任务/u)?.[1] || "";
    return promptPath
      && promptPath.startsWith(launched.isolatedUserData)
      && existsSync(promptPath)
      && existsSync(path.join(path.dirname(promptPath), "change-request.json"));
  }, { timeout: 30_000, label: "frozen AI request" });
  const requestRoot = path.dirname(promptPath);
  const changeRequest = JSON.parse(readFileSync(path.join(requestRoot, "change-request.json"), "utf8"));
  writeAiOutput(requestRoot, (base) => {
    const marker = `<div id="${reviewMarker}" style="padding:12px;background:#695ce7;color:white;text-align:center">真实 HTML 审阅性能测试</div>`;
    if (/<body\b[^>]*>/iu.test(base)) {
      return base.replace(/(<body\b[^>]*>)/iu, `$1\n${marker}`);
    }
    return base.replace(/<\/html>/iu, `<body>${marker}</body></html>`);
  });
  const finalizeStarted = performance.now();
  runOfficialFinalizer(requestRoot, changeRequest);
  await waitUntil(
    () => page.getByTestId("ai-conversation-action-bar").textContent()
      .then((text) => text?.includes("等待你的决定")),
    { timeout: 45_000, label: "review candidate ready" },
  );
  results.review.candidateReadyMs = round(performance.now() - finalizeStarted);
  return { requestRoot, changeRequest };
}

async function exerciseReviewAndAccept() {
  const page = launched.page;
  await createRealReviewCandidate();
  const openStarted = performance.now();
  await page.getByRole("button", { name: "审阅对比" }).click();
  const workspace = page.getByTestId("ai-review-workspace");
  await workspace.waitFor({ state: "visible", timeout: 45_000 });
  results.review.shellVisibleMs = round(performance.now() - openStarted);
  const before = page.frameLocator('iframe[title^="修改前"]');
  const after = page.frameLocator('iframe[title^="修改后"]');
  await waitUntil(async () => Promise.all([
    before.locator("body").evaluate((body) => (body.innerText || body.textContent || "").length > 20),
    after.locator("body").evaluate((body) => (body.innerText || body.textContent || "").length > 20),
  ]).then((values) => values.every(Boolean)), {
    timeout: 45_000,
    label: "dual review pages visible",
  });
  results.review.dualPagesVisibleMs = round(performance.now() - openStarted);
  await waitUntil(async () => Promise.all([
    before.locator("html").evaluate((html) => html.ownerDocument.readyState),
    after.locator("html").evaluate((html) => html.ownerDocument.readyState),
  ]).then((values) => values.every((value) => value === "complete")), {
    timeout: 45_000,
    label: "dual review pages first paint ready",
  });
  results.review.dualPagesFirstPaintReadyMs = round(performance.now() - openStarted);
  const [beforeRendered, afterRendered] = await Promise.all([
    waitForRenderedContent(() => before, openStarted, {
      label: "review before page full HTML and charts",
      expectCharts: true,
    }),
    waitForRenderedContent(() => after, openStarted, {
      label: "review after page full HTML and charts",
      expectCharts: true,
    }),
  ]);
  results.review.beforeRendered = beforeRendered;
  results.review.afterRendered = afterRendered;
  results.review.dualPagesFullContentMs = (
    beforeRendered.fullContentReadyMs !== null
    && afterRendered.fullContentReadyMs !== null
  ) ? Math.max(
      beforeRendered.fullContentReadyMs,
      afterRendered.fullContentReadyMs,
    ) : null;
  await waitUntil(async () => Promise.all([
    before.locator("html").getAttribute("data-stemmio-review-filter"),
    after.locator("html").getAttribute("data-stemmio-review-filter"),
  ]).then((values) => values.every(Boolean)), {
    timeout: 45_000,
    label: "review annotations ready",
  });
  results.review.annotationsReadyMs = round(performance.now() - openStarted);
  results.review.overlayCounts = {
    before: await before.locator("[data-stemmio-review-overlay-box]").count(),
    after: await after.locator("[data-stemmio-review-overlay-box]").count(),
  };
  const reviewMemory = await rendererMemory("review-dual-page");
  assert.equal(
    reviewMemory.resources.review.iframeCount,
    2,
    "review-dual-page: expected both Review iframes to be mounted",
  );
  assert.equal(
    reviewMemory.charts.pageCount,
    2,
    "review-dual-page: expected chart evidence from both Review pages",
  );
  assert.equal(
    reviewMemory.charts.completePageCount,
    2,
    "review-dual-page: one or more Review pages has incomplete charts",
  );
  const modes = [
    { key: "beforeOnly", name: /^(?:只看修改前|单独查看修改前(?: .+)?)$/u },
    { key: "afterOnly", name: /^(?:只看修改后|单独查看 AI 修改后(?: .+)?)$/u },
    { key: "split", name: /^双页对比(?:（修改前与 AI 修改后）)?$/u },
  ];
  results.review.modeSwitchMs = {};
  for (const mode of modes) {
    const button = page.getByRole("button", { name: mode.name });
    const started = performance.now();
    await button.click();
    await waitUntil(
      () => button.getAttribute("aria-pressed").then((value) => value === "true"),
      { timeout: 10_000, label: `review mode ${mode.key}` },
    );
    results.review.modeSwitchMs[mode.key] = round(performance.now() - started);
  }
  await page.screenshot({
    path: path.join(screenshotsRoot, "04-review-dual-real-html.png"),
    animations: "disabled",
  });
  const oldSourcePath = (await activeProject()).sourcePath;
  const acceptStarted = performance.now();
  await page.getByRole("button", { name: /^(?:采纳修改|采纳 AI 修改)$/u }).click();
  await page.getByRole("button", { name: "确认并采纳" }).click();
  await waitUntil(async () => {
    const project = await activeProject();
    return project?.sourcePath && project.sourcePath !== oldSourcePath
      && await workspace.count() === 0;
  }, { timeout: 45_000, label: "review accepted and new HTML opened" });
  const acceptDisplayPromise = firstUsefulDocumentVisible({ timeout: 45_000 })
    .then(() => performance.now() - acceptStarted);
  const acceptEditorPromise = activeContentReady({ timeout: 45_000 })
    .then(() => performance.now() - acceptStarted);
  const [acceptDisplayReadyMs, acceptEditReadyMs] = await Promise.all([
    acceptDisplayPromise,
    acceptEditorPromise,
  ]);
  results.review.acceptDisplayReadyMs = round(acceptDisplayReadyMs);
  results.review.acceptEditReadyMs = round(acceptEditReadyMs);
  results.review.acceptToNewHtmlMs = round(acceptEditReadyMs);
  results.review.acceptedRendered = await waitForRenderedContent(
    () => currentEditorFrame(page),
    acceptStarted,
    { label: "accepted HTML full content", expectCharts: true },
  );
  results.review.acceptedSourcePath = (await activeProject()).sourcePath;
  assert(readFileSync(results.review.acceptedSourcePath, "utf8").includes(reviewMarker));
  const acceptMemory = await rendererMemory("accept");
  assertReviewResourcesReleased(acceptMemory);
}

async function openAfterAccept(source) {
  const page = launched.page;
  const beforeOpenProject = await activeProject();
  const beforeOpenSourcePath = beforeOpenProject?.sourcePath || null;
  assert(beforeOpenSourcePath, "post-accept open requires one active source identity");
  const tabs = page.getByRole("tablist", { name: "已打开的页面" }).getByRole("tab");
  const beforeClose = await tabs.count();
  assert.equal(beforeClose, 20);
  const lastContainer = page.locator(".workbench-tab").nth(beforeClose - 1);
  await lastContainer.getByRole("button", { name: /^关闭 /u }).click();
  await waitUntil(() => tabs.count().then((count) => count === 19), {
    timeout: 30_000,
    label: "close one tab before post-accept open",
  });
  await launched.electronApp.evaluate(({ dialog }, sourcePath) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [sourcePath] });
  }, source.copyPath);
  const started = performance.now();
  await requestLocalHtmlOpen(page);
  const openLocalButton = page.locator(".open-local-button");
  let pendingImport = await waitUntil(async () => {
    if (await openLocalButton.isVisible().catch(() => false)) return "picker";
    const project = await activeProject();
    if (project?.sourcePath && project.sourcePath !== beforeOpenSourcePath) return "opened";
    return "";
  }, { timeout: 15_000, label: "post-accept open handoff" });
  if (pendingImport === "picker") {
    await openLocalButton.click();
    pendingImport = await waitUntil(async () => {
      const project = await activeProject();
      if (project?.sourcePath && project.sourcePath !== beforeOpenSourcePath) return "opened";
      return "";
    }, { timeout: 15_000, label: "post-accept picker handoff" });
  }
  await waitUntil(async () => {
    const project = await activeProject();
    return project?.sourcePath && project.sourcePath !== beforeOpenSourcePath;
  }, { timeout: 45_000, label: "post-accept active source transition" });
  const displayPromise = firstUsefulDocumentVisible({
    timeout: 45_000,
  }).then(() => performance.now() - started);
  const editorPromise = activeContentReady({ timeout: 45_000 })
    .then((value) => ({ ...value, editReadyMs: performance.now() - started }));
  const [displayReadyMs, { editor, editReadyMs }] = await Promise.all([
    displayPromise,
    editorPromise,
  ]);
  results.acceptThenOpen.visibleMs = round(displayReadyMs);
  results.acceptThenOpen.displayReadyMs = round(displayReadyMs);
  results.acceptThenOpen.editReadyMs = round(editReadyMs);
  results.acceptThenOpen.rendered = await waitForRenderedContent(
    () => currentEditorFrame(page),
    started,
    {
      label: "post-accept new HTML full content",
      expectCharts: expectsRenderedChart(readFileSync(source.original, "utf8")),
    },
  );
  await finishActiveReadiness(editor);
  const openedProject = await activeProject();
  assert.notEqual(openedProject?.sourcePath, beforeOpenSourcePath);
  assert.equal(
    withoutStableIdentity(openedProject?.html),
    readFileSync(source.original, "utf8"),
    "post-accept import changed authored HTML beyond Stable ID materialization",
  );
  results.acceptThenOpen.activeSourcePath = openedProject.sourcePath;
  results.acceptThenOpen.readyMs = round(performance.now() - started);
  results.acceptThenOpen.finalTabCount = await tabs.count();
  assert.equal(results.acceptThenOpen.finalTabCount, 20);
}

try {
  launched = await launchStemmio({
    electronLauncher: packagedLauncher,
    firstWindowTimeout: 30_000,
    userDataPrefix: "stemmio-native-e2e-htmlperf-",
  });
  await launched.page.waitForFunction(
    () => Boolean(window.stemmioRuntime?.getBridgeConnection?.()),
    undefined,
    { timeout: 30_000 },
  );
  results.startup = await launched.page.evaluate(() => ({
    desktop: window.stemmioRuntime?.getStartupTiming?.()
      || window.stemmioRuntime?.diagnostics?.startupTiming
      || null,
    rendererTimeOriginUnixMs: performance.timeOrigin,
    paintEntries: performance.getEntriesByType("paint").map((entry) => ({
      name: entry.name,
      startTime: entry.startTime,
    })),
    marks: performance.getEntriesByType("mark")
      .filter((entry) => entry.name.startsWith("stemmio:renderer:"))
      .map((entry) => ({ name: entry.name, startTime: entry.startTime })),
  }));
  const desktopStartupMarks = Object.fromEntries(
    (results.startup.desktop?.marks || []).map((entry) => [entry.stage, entry.atUnixMs]),
  );
  const firstPaint = results.startup.paintEntries
    .find((entry) => entry.name === "first-paint");
  const firstPaintUnixMs = Number(results.startup.rendererTimeOriginUnixMs)
    + Number(firstPaint?.startTime);
  assert(
    desktopStartupMarks["renderer-shell-load-start"] < desktopStartupMarks["bridge-start"],
    "renderer shell navigation must begin before Bridge startup",
  );
  assert(
    firstPaintUnixMs < desktopStartupMarks["bridge-ready"],
    "renderer first paint must not wait for Bridge readiness",
  );
  assert(
    desktopStartupMarks["telemetry-start"] >= desktopStartupMarks["window-ready-to-show"],
    "usage telemetry must start after the window is ready to show",
  );
  results.startup.summary = {
    processToFirstPaintMs: round(firstPaintUnixMs - desktopStartupMarks["process-start"]),
    firstPaintLeadOverBridgeMs: round(desktopStartupMarks["bridge-ready"] - firstPaintUnixMs),
    processToBridgeReadyMs: round(
      desktopStartupMarks["bridge-ready"] - desktopStartupMarks["process-start"],
    ),
  };
  launched.page.on("pageerror", (error) => {
    results.faults.pageErrors.count += 1;
    if (results.faults.pageErrors.samples.length < 50) {
      results.faults.pageErrors.samples.push(String(error));
    }
  });
  launched.page.on("console", (message) => {
    if (message.type() !== "error") return;
    results.faults.consoleErrors.count += 1;
    if (results.faults.consoleErrors.samples.length < 50) {
      results.faults.consoleErrors.samples.push(message.text());
    }
  });
  launched.page.on("crash", () => { results.faults.crashes += 1; });
  await launched.page.evaluate(() => {
    window.__qaLongTasks = [];
    window.__qaIframeAdds = 0;
    window.__qaIframeRemoves = 0;
    try {
      window.__qaLongTaskObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__qaLongTasks.push({ startTime: entry.startTime, duration: entry.duration });
        }
      });
      window.__qaLongTaskObserver.observe({ type: "longtask", buffered: true });
    } catch {}
    window.__qaIframeObserver = new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element)) continue;
          window.__qaIframeAdds += node.matches("iframe") ? 1 : node.querySelectorAll("iframe").length;
        }
        for (const node of record.removedNodes) {
          if (!(node instanceof Element)) continue;
          window.__qaIframeRemoves += node.matches("iframe") ? 1 : node.querySelectorAll("iframe").length;
        }
      }
    });
    window.__qaIframeObserver.observe(document.body, { childList: true, subtree: true });
  });
  await rendererMemory("launch");

  for (let index = 0; index < 20; index += 1) {
    await openThroughInput(copiedSources[index], index + 1);
    if (index === 0) {
      const initialTabs = launched.page.getByRole("tablist", { name: "已打开的页面" })
        .getByRole("tab");
      if (await initialTabs.count() === 2) {
        await launched.page.locator(".workbench-tab").first()
          .getByRole("button", { name: /^关闭 /u }).click();
        await waitUntil(() => initialTabs.count().then((count) => count === 1), {
          timeout: 30_000,
          label: "close initial welcome tab",
        });
        results.opening[0].tabCount = 1;
      }
      await exerciseEditAndPreview();
      await rendererMemory("1-tab-after-edit-preview");
    }
    const count = index + 1;
    if (count === 2) {
      await runSwitchBatch("2-tabs", [0, 1, 0, 1]);
      await rendererMemory("2-tabs");
    }
    if (count === 5) {
      await runSwitchBatch("5-tabs", [0, 2, 4, 1, 3, 0]);
      await rendererMemory("5-tabs");
    }
    if (count === 10) {
      await runSwitchBatch("10-tabs", [0, 4, 9, 2, 7, 0]);
      await rendererMemory("10-tabs");
    }
  }
    const tabCount = await launched.page.getByRole("tablist", { name: "已打开的页面" })
    .getByRole("tab").count();
  assert.equal(tabCount, 20);
  results.cacheBudget.after20Opens = await cacheState();
  assertCacheBudget(results.cacheBudget.after20Opens, "20 opens", {
    minimumRuntimeHotCount: 1,
  });
  await launched.page.screenshot({
    path: path.join(screenshotsRoot, "03-twenty-tabs-real-html.png"),
    animations: "disabled",
  });
  await runSwitchBatch("20-tabs", [0, 9, 19, 4, 14, 0, 19, 10]);
  await runSwitchBatch(
    "20-tabs-stress-40-switches",
    Array.from({ length: 40 }, (_, index) => (index * 7) % 20),
  );
  results.cacheBudget.after40Switches = await cacheState();
  assertCacheBudget(results.cacheBudget.after40Switches, "40 switches", {
    minimumRuntimeHotCount: 1,
  });
  await rendererMemory("20-tabs-after-stress");

  await switchTo(0);
  await exerciseReviewAndAccept();
  await openAfterAccept(copiedSources[20]);
  await rendererMemory("post-accept-open");
  results.performanceTimeline = await rendererPerformanceTimeline();

  results.openingSummary = {
    visible: summarize(results.opening.map((sample) => sample.visibleMs)),
    displayReady: summarize(results.opening.map((sample) => sample.displayReadyMs)),
    editReady: summarize(results.opening.map((sample) => sample.editReadyMs)),
    textVisible: summarize(results.opening.map((sample) => sample.textVisibleMs)),
    allChartsReady: summarize(results.opening
      .map((sample) => sample.allChartsReadyMs)
      .filter((value) => value !== null)),
    fullContentReady: summarize(results.opening
      .map((sample) => sample.fullContentReadyMs)
      .filter((value) => value !== null)),
    incompleteChartPages: results.opening
      .filter((sample) => sample.fullContentReadyMs === null)
      .map((sample) => ({ fileName: sample.fileName, renderFacts: sample.renderFacts })),
    verified: summarize(results.opening.map((sample) => sample.verifiedMs)),
    ready: summarize(results.opening.map((sample) => sample.readyMs)),
  };
  results.completedAt = new Date().toISOString();
  results.status = "passed";
} catch (error) {
  results.completedAt = new Date().toISOString();
  results.status = "failed";
  results.failure = {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : null,
    runtime: launched ? await launched.page.evaluate(async () => ({
      activeProject: await window.stemmioProjects?.getActiveProject?.() ?? null,
      projectState: document.querySelector("main.workbench")
        ?.getAttribute("data-project-state") ?? null,
      visibleText: (document.body?.innerText || "").slice(0, 4_000),
      visibleAlerts: [...document.querySelectorAll('[role="alert"]')]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => element.textContent?.trim() || ""),
      visibleButtons: [...document.querySelectorAll("button")]
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => element.textContent?.trim() || "")
        .filter(Boolean),
    })).catch((cause) => ({ diagnosticsError: String(cause) })) : null,
  };
  console.error(error);
  process.exitCode = 1;
} finally {
  results.sourceIntegrityAfter = results.sources.map((source) => {
    const filePath = path.join(sourceRoot, source.fileName);
    const afterSha256 = sha256(filePath);
    return {
      fileName: source.fileName,
      beforeSha256: source.sha256,
      afterSha256,
      unchanged: source.sha256 === afterSha256,
    };
  });
  if (launched) {
    await stopStemmio(launched.electronApp, launched.isolatedUserData).catch((error) => {
      results.cleanupError = String(error);
    });
  }
  rmSync(copiedSourceRoot, { recursive: true, force: true });
  writeFileSync(
    path.join(outputRoot, "results.json"),
    `${JSON.stringify(results, null, 2)}\n`,
    "utf8",
  );
  console.log("RESULTS", path.join(outputRoot, "results.json"));
}

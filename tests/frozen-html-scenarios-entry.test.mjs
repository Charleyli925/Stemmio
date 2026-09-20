import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

import { materializeSourceElementIdentity } from "../bridge/project-file-repository/working-copy.mjs";
import { FROZEN_SCENARIO_DEFINITIONS } from "./e2e/electron/real-html/frozen-entry-contract.mjs";
import { workspaceSourceFingerprint } from "./e2e/electron/real-html/workspace-provenance.mjs";
import { digestFrozenEntry } from "./e2e/electron/real-html/frozen-entry-contract.mjs";
import { FROZEN_FORMAT_OPERATIONS, FROZEN_STRUCTURE_CLOSED_LOOP_OPERATIONS,
  FROZEN_STRUCTURE_PROBE_OPERATIONS, frozenDigest, readFrozenSelection } from "./e2e/electron/real-html/frozen-selection.mjs";
import {
  aggregateCapabilityPreflightReports,
  executePlan,
  ensureRendererBuilt,
  preflightReportDirectoryFromOutput,
  runCommand,
} from "./e2e/electron/frozen-html-scenarios.mjs";

const root = path.resolve(import.meta.dirname, "..");
const entry = path.join(root, "tests/e2e/electron/frozen-html-scenarios.mjs");

function run(args, env = process.env) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
  });
}

test("frozen scenario list is available without building or starting Electron", () => {
  const result = run(["--list"]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.scenarios.map(({ id }) => id), ["A", "B", "C"]);
  assert.match(output.note, /does not start Electron/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /desktop:renderer/u);
});

test("preflight requires an explicit corpus and does not fall back to discovery", () => {
  const env = { ...process.env };
  delete env.STEMMIO_REAL_HTML_DIR;
  const result = run(["--preflight"], env);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /FROZEN_ENTRY_CORPUS_REQUIRED/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /AUTOMATIC_DISCOVERY_EXECUTION/u);
});

test("isolated capability preflight reports aggregate only matching source provenance", () => {
  const expectedFile = (index) => ({
    childIndex: index,
    selectedFileIndex: index + 1,
    fileId: `H0${index + 1}`,
    originalSha256: `${index + 1}`.repeat(64),
    originalSize: 10 + index,
    frozenSeedRelativePath: `${index}/frozen-managed-seed.html`,
    frozenSeed: {
      relativePath: `${index}/frozen-managed-seed.html`,
      sha256: `${index + 3}`.repeat(64),
      size: 20 + index,
    },
  });
  const report = (index) => ({
    schemaVersion: 4,
    mode: "capability-preflight-only",
    head: "a".repeat(40),
    tree: "b".repeat(40),
    workspaceSourceSha256: "c".repeat(64),
    untrackedSourceFileCount: 0,
    planned: 1,
    corpusFiles: 2,
    selectedFileIndexes: [index + 1],
    results: [{
      fileId: `H0${index + 1}`,
      originalSha256: `${index + 1}`.repeat(64),
      originalSize: 10 + index,
      originalUnchanged: true,
      status: "PENDING_REVIEW",
      preflightWorkingCopy: {
        beforeSha256: `${index + 3}`.repeat(64),
        beforeSize: 20 + index,
        afterSha256: `${index + 3}`.repeat(64),
        afterSize: 20 + index,
        unchanged: true,
        frozenSeed: {
          relativePath: `${index}/frozen-managed-seed.html`,
          sha256: `${index + 3}`.repeat(64),
          size: 20 + index,
          exactManagedCopy: true,
        },
      },
      capabilityManifest: { fingerprint: `f${index}`, draft: { issues: [] } },
    }],
  });
  const expectedFiles = [expectedFile(0), expectedFile(1)];
  const aggregate = aggregateCapabilityPreflightReports(
    [report(0), report(1)],
    expectedFiles,
  );
  assert.equal(aggregate.planned, 2);
  assert.equal(aggregate.pendingReview, 2);
  assert.equal(aggregate.originalsUnchanged, true);
  assert.match(aggregate.draftFingerprint, /^[a-f0-9]{64}$/u);
  assert.equal(
    preflightReportDirectoryFromOutput("Private report: /tmp/stemmio-report\n"),
    "/tmp/stemmio-report",
  );
  assert.throws(
    () => aggregateCapabilityPreflightReports([
      report(0),
      { ...report(1), workspaceSourceSha256: "d".repeat(64) },
    ], expectedFiles),
    { code: "FROZEN_ENTRY_PREFLIGHT_PROVENANCE_MISMATCH" },
  );
  assert.throws(
    () => aggregateCapabilityPreflightReports([report(0), report(0)], expectedFiles),
    { code: "FROZEN_ENTRY_PREFLIGHT_FILE_DUPLICATE" },
  );
  assert.throws(
    () => aggregateCapabilityPreflightReports([
      report(0),
      {
        ...report(1),
        results: [{ ...report(1).results[0], originalSize: 99 }],
      },
    ], expectedFiles),
    { code: "FROZEN_ENTRY_PREFLIGHT_FILE_BINDING_MISMATCH" },
  );
  assert.throws(
    () => aggregateCapabilityPreflightReports([
      report(0),
      {
        ...report(1),
        results: [{
          ...report(1).results[0],
          preflightWorkingCopy: {
            ...report(1).results[0].preflightWorkingCopy,
            afterSha256: "f".repeat(64),
          },
        }],
      },
    ], expectedFiles),
    { code: "FROZEN_ENTRY_PREFLIGHT_SEED_BINDING_MISMATCH" },
  );
});

test("plan validation fails before renderer build when a nested manifest is missing", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "stemmio-frozen-entry-test-"));
  const current = workspaceSourceFingerprint(root);
  const plan = {
    schemaVersion: 1,
    kind: "stemmio-frozen-scenario-plan",
    reviewStatus: "FROZEN",
    reviewedBy: "root",
    version: current,
    scenarios: FROZEN_SCENARIO_DEFINITIONS.map((definition) => ({
      id: definition.id,
      label: definition.label,
      purpose: definition.purpose,
      runner: definition.runner,
      scope: definition.allowedScopes[0],
      manifestPath: path.join(directory, `${definition.id}.json`),
      manifestSha256: "a".repeat(64),
    })),
  };
  plan.scenarios[1].scope = "core-three-cycle";
  const file = path.join(directory, "plan.json");
  const bytes = Buffer.from(JSON.stringify(plan));
  await writeFile(file, bytes);
  const result = run([
    "--plan", "--manifest", file, "--manifest-sha256", digestFrozenEntry(bytes),
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /FROZEN_ENTRY_SCENARIO_MANIFEST_READ_FAILED/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /desktop:renderer/u);
});

function dispatcherFixture(version) {
  const scenarios = FROZEN_SCENARIO_DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    purpose: definition.purpose,
    runner: definition.runner,
    scope: definition.allowedScopes[0],
    manifestPath: `/tmp/frozen-${definition.id}.json`,
    manifestSha256: `${definition.id.toLowerCase()}${"a".repeat(63)}`,
  }));
  return {
    plan: {
      schemaVersion: 1,
      kind: "stemmio-frozen-scenario-plan",
      reviewStatus: "FROZEN",
      reviewedBy: "root",
      digest: "d".repeat(64),
      version,
      scenarios,
      definitions: FROZEN_SCENARIO_DEFINITIONS,
    },
    nestedPlans: [
      {
        scope: "core-text-format", operation: "native-text", initialRuntime: "static", reopen: true,
        targets: [{ selectedId: "a-target", selectedTag: "p", operations: ["activate", "input", "backspace", "save", "undo", "redo"], historyResume: "in-place" }],
      },
      {
        scope: "core-three-cycle", operation: "mixed", initialRuntime: "static", reopen: true, cycles: 3,
        targets: [
          { selectedId: "b-text", selectedTag: "p", operations: ["activate", "input", "backspace", "save", "undo", "redo"], historyResume: "in-place" },
          { selectedId: "b-structure", selectedTag: "p", operations: ["copy", "select-copy", "activate-copy", "input-copy", "save-copy"] },
        ],
      },
      {
        scope: "core-structure-closed-loop", operation: "structure", initialRuntime: "runtime", reopen: true,
        targets: [{ selectedId: "c-target", selectedTag: "p", expectedProjection: "in-place", operations: ["copy", "move-copy", "input-restored", "save-restored"],
          projectionByOperation: { copy: "in-place", "move-copy": "recovered" }, rebuildPath: "runtime-candidate",
          rebuildTrigger: "accepted-projection-failure", destinationParentId: "c-parent", destinationBeforeElementId: "c-target" }],
      },
    ],
  };
}

function passChildReport(env, version, nestedPlan, { incomplete = false } = {}) {
  const rows = (operations, targetId) => operations.map((operation) => {
    let actual = { observed: true, targetId };
    if (["input", "input-copy", "input-restored"].includes(operation)) {
      actual = { id: targetId, focusedId: targetId, appended: `[[${operation}:OBSERVED]]` };
    } else if (["backspace", "delete-forward"].includes(operation)) {
      actual = { removed: "X" };
    } else if (["save", "save-copy", "save-newline"].includes(operation)) {
      actual = { sourceSha256: "a".repeat(64), sourceContains: operation, outsideUnchanged: true,
        changedRanges: { start: 0, end: 1 } };
    } else if (operation === "save-restored") {
      actual = { restoredSha256: "a".repeat(64), persistedRevision: 1 };
    }
    return { operation, targetId, state: "PASS", reason: "EXPECTED", durationMs: 1, actual };
  });
  const copyIdFor = (index) => {
    const digit = String.fromCharCode(98 + index);
    return `sm1_${digit.repeat(12)}4${digit.repeat(3)}8${digit.repeat(15)}`;
  };
  const copyConditions = Object.fromEntries([
    "originalUnique", "originalBytesMatch", "originalLeaf", "parentMatches", "siblingMatches", "offsetMatches",
    "positiveInsertion", "prefixUnchanged", "suffixUnchanged", "oneLeafInserted", "freshId",
    "idsUnique", "exactlyOneAdded", "copyAttributeShape", "equivalentBytes", "copyParentMatches",
  ].map((key) => [key, true]));
  const lifecycle = { candidateRecords: [], lifecycleRecords: [], records: [] };
  const runtimeConfig = {
    windowMode: env.STEMMIO_E2E_WINDOW_MODE || "visible-background",
    structuralInPlace: "enabled",
  };
  const report = {
    schemaVersion: 1,
    kind: "stemmio-frozen-html-operation-result",
    scenarioId: env.STEMMIO_FROZEN_SCENARIO_ID,
    scope: env.STEMMIO_FROZEN_SCENARIO_SCOPE,
    manifestDigest: env.STEMMIO_FROZEN_MANIFEST_SHA256,
    reportPath: env.STEMMIO_FROZEN_REPORT_PATH,
    reportDirectory: path.dirname(env.STEMMIO_FROZEN_REPORT_PATH),
    version,
    runtimeConfig,
    state: "PASS",
    cleanup: "PASS",
    calls: [{ kind: "fixture" }],
    source: { hashMatches: true, sizeMatches: true },
    display: {
      working: "sha256:a", displayed: "sha256:a",
      conditions: { workingMatches: true, displayedMatches: true },
    },
    finalSource: { hashMatches: true, sizeMatches: true },
    lifecycle,
    reopen: {
      state: "PASS", reason: "EXACT_REOPEN", durationMs: 1,
      source: { hashMatches: true, sizeMatches: true },
      display: { workingMatches: true, displayedMatches: true },
      target: { id: nestedPlan.targets[0].selectedId, tag: nestedPlan.targets[0].selectedTag || "p" },
      output: null,
      runtimeConfig,
    },
  };
  if (env.STEMMIO_FROZEN_SCENARIO_ID === "A") {
    report.operation = {
      operation: "select", targetId: nestedPlan.targets[0].selectedId,
      state: incomplete ? "NOT_EXECUTED" : "PASS", reason: "EXPECTED", durationMs: 1,
      actual: nestedPlan.targets[0].selectedId,
    };
    report.textOperations = rows(nestedPlan.targets[0].operations, nestedPlan.targets[0].selectedId);
    if (incomplete) report.textOperations = report.textOperations.slice(0, 1);
  }
  if (env.STEMMIO_FROZEN_SCENARIO_ID === "B") report.mixed = {
    cycles: Array.from({ length: nestedPlan.cycles }, (_, index) => ({
      cycle: undefined,
      control: ["select-text", "create-comment", "select-structure", "resume-text", "verify-cycle"].map((operation) => ({
        operation,
        targetId: operation === "select-structure" ? nestedPlan.targets[1].selectedId : nestedPlan.targets[0].selectedId,
        state: "PASS",
        reason: "EXPECTED",
        durationMs: 1,
        actual: { observed: true, targetId: operation === "select-structure" ? nestedPlan.targets[1].selectedId : nestedPlan.targets[0].selectedId },
      })),
      text: rows(nestedPlan.targets[0].operations, nestedPlan.targets[0].selectedId),
      structure: rows(nestedPlan.targets[1].operations, nestedPlan.targets[1].selectedId).map((row, rowIndex) => (
        rowIndex === 0 ? { ...row, actual: { source: { copyId: copyIdFor(index), conditions: copyConditions } } } : row
      )),
      continuation: rows(["activate", "input", "backspace", "save", "undo", "redo"], nestedPlan.targets[0].selectedId),
    })),
    copyIds: [copyIdFor(0), copyIdFor(1), copyIdFor(2)],
    checkpoint: rows(["reopen-cumulative", "delete-comment-1", "delete-comment-2", "delete-comment-3"], nestedPlan.targets[0].selectedId),
  };
  if (env.STEMMIO_FROZEN_SCENARIO_ID === "B") {
    report.mixed.cycles = report.mixed.cycles.map((cycle, index) => ({
      ...cycle,
      cycle: index + 1,
      structure: cycle.structure.map((row, rowIndex) => ({
        ...row,
        targetId: rowIndex === 0 || row.operation.startsWith("probe-")
          ? nestedPlan.targets[1].selectedId : report.mixed.copyIds[index],
      })),
    }));
  }
  if (env.STEMMIO_FROZEN_SCENARIO_ID === "C") {
    const copyId = copyIdFor(4);
    report.structure = { copyId, reopenCopyPresent: true };
    report.operation = { operation: "select", targetId: "c-target", state: "PASS", reason: "EXPECTED", durationMs: 1,
      actual: "c-target" };
    const runtimeConditions = {
      knownExpectedPath: true, pathMatches: true, sourceMatches: true, documentKnown: true,
      generationKnown: true, documentMatches: true, generationMatches: true,
      requestMatches: true, candidateMatches: true, candidateReady: true,
      generationObserved: true, activeMatches: true, runtimeReady: true, noRejectedCandidate: true,
    };
    report.structureOperations = rows(nestedPlan.targets[0].operations, nestedPlan.targets[0].selectedId)
    .map((row) => row.operation === "copy"
      ? { ...row, actual: { source: { copyId, conditions: copyConditions } } }
      : row)
    .map((row) => row.operation === "move-copy"
      ? { ...row, targetId: copyId, actual: {
        planned: "in-place", outcome: "recovered", runtime: {
          path: "runtime-candidate", conditions: runtimeConditions,
          terminalConditions: { phaseSettled: true, runtimeReady: true },
          candidateId: "c-candidate", generation: 2,
        },
      } }
      : row)
      .map((row, rowIndex) => ({ ...row, targetId: rowIndex === 0 ? "c-target" : copyId }));
    report.structureOperations = report.structureOperations.map((row) => row.operation === "input-restored"
      ? { ...row, actual: { id: copyId, appended: "[[C:RESTORED]]" } }
      : row.operation === "save-restored"
        ? { ...row, actual: { restoredSha256: "a".repeat(64), persistedRevision: 1 } }
        : row);
    report.lifecycle = {
      candidateRecords: [{ kind: "candidate-created", candidateId: "c-candidate", generation: "2" }],
      lifecycleRecords: [
        { kind: "rebuild-request", sourceRevision: "sha256:a" },
        { kind: "candidate-terminal", candidateId: "c-candidate", terminal: "ready" },
        { kind: "generation", beforeGeneration: "1", afterGeneration: "2", generation: "2", candidateId: "c-candidate" },
        { kind: "active-identity", candidateId: "c-candidate", generation: "2", documentId: "doc-c" },
        { kind: "runtime-terminal", candidateId: "c-candidate", generation: "2", phase: "settled", outcome: "ready", terminal: "ready" },
      ],
      records: [
        { kind: "candidate-created", candidateId: "c-candidate", generation: "2" },
        { kind: "rebuild-request", sourceRevision: "sha256:a" },
        { kind: "candidate-terminal", candidateId: "c-candidate", terminal: "ready" },
        { kind: "generation", beforeGeneration: "1", afterGeneration: "2", generation: "2", candidateId: "c-candidate" },
        { kind: "active-identity", candidateId: "c-candidate", generation: "2", documentId: "doc-c" },
        { kind: "runtime-terminal", candidateId: "c-candidate", generation: "2", phase: "settled", outcome: "ready", terminal: "ready" },
      ],
    };
    report.reopen.output = { id: copyId, present: true };
  }
  return report;
}

test("valid dispatch records A→B→C child reports and evidence paths", async () => {
  const version = workspaceSourceFingerprint(root);
  const { plan, nestedPlans } = dispatcherFixture(version);
  const result = await executePlan(plan, version, nestedPlans, {
    build: async () => ({ exitCode: 0 }),
    run: async (_command, _args, { env }) => {
      await writeFile(env.STEMMIO_FROZEN_REPORT_PATH,
        JSON.stringify(passChildReport(env, version, nestedPlans[env.STEMMIO_FROZEN_SCENARIO_ID === "A" ? 0 : env.STEMMIO_FROZEN_SCENARIO_ID === "B" ? 1 : 2])));
      return { exitCode: 0, signal: null, timedOut: false, spawnError: null,
        cleanup: { attempted: false, confirmed: true, signal: null } };
    },
    print: false,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.report.ledger.map(({ id, state }) => [id, state]), [["A", "PASS"], ["B", "PASS"], ["C", "PASS"]]);
  assert.equal(result.report.scenarioReports.length, 3);
  assert.ok(result.report.scenarioReports.every(({ reportPath, evidence }) => reportPath.endsWith("/result.json") && evidence));
});

test("B ledger rejects a missing cycle stage instead of counting cycle objects", async () => {
  const version = workspaceSourceFingerprint(root);
  const { plan, nestedPlans } = dispatcherFixture(version);
  const result = await executePlan(plan, version, nestedPlans, {
    build: async () => ({ exitCode: 0 }),
    run: async (_command, _args, { env }) => {
      const index = env.STEMMIO_FROZEN_SCENARIO_ID === "A" ? 0
        : env.STEMMIO_FROZEN_SCENARIO_ID === "B" ? 1 : 2;
      const report = passChildReport(env, version, nestedPlans[index]);
      if (env.STEMMIO_FROZEN_SCENARIO_ID === "B") report.mixed.cycles[1].structure.pop();
      await writeFile(env.STEMMIO_FROZEN_REPORT_PATH, JSON.stringify(report));
      return { exitCode: 0, timedOut: false, signal: null, spawnError: null,
        cleanup: { attempted: false, confirmed: true, signal: null } };
    },
    print: false,
  });
  assert.equal(result.report.ledger[0].state, "PASS");
  assert.equal(result.report.ledger[1].state, "FAIL");
  assert.equal(result.report.ledger[1].reason, "CHILD_REPORT_PROTOCOL_FAILED");
  assert.equal(result.report.ledger[2].state, "PASS");
  assert.equal(result.report.scenarioReports[1].firstFailure?.code,
    "FROZEN_ENTRY_CHILD_OPERATION_LEDGER_MISMATCH");
});

test("C ledger rejects a rebuild report with the wrong path or lifecycle proof", async () => {
  const version = workspaceSourceFingerprint(root);
  const { plan, nestedPlans } = dispatcherFixture(version);
  const result = await executePlan(plan, version, nestedPlans, {
    build: async () => ({ exitCode: 0 }),
    run: async (_command, _args, { env }) => {
      const index = env.STEMMIO_FROZEN_SCENARIO_ID === "A" ? 0
        : env.STEMMIO_FROZEN_SCENARIO_ID === "B" ? 1 : 2;
      const report = passChildReport(env, version, nestedPlans[index]);
      if (env.STEMMIO_FROZEN_SCENARIO_ID === "C") {
        const move = report.structureOperations.find((row) => row.operation === "move-copy");
        move.actual.runtime.path = "in-place";
        move.actual.runtime.conditions.pathMatches = false;
      }
      await writeFile(env.STEMMIO_FROZEN_REPORT_PATH, JSON.stringify(report));
      return { exitCode: 0, timedOut: false, signal: null, spawnError: null,
        cleanup: { attempted: false, confirmed: true, signal: null } };
    },
    print: false,
  });
  assert.equal(result.report.ledger[0].state, "PASS");
  assert.equal(result.report.ledger[1].state, "PASS");
  assert.equal(result.report.ledger[2].state, "FAIL");
  assert.equal(result.report.ledger[2].reason, "CHILD_REPORT_PROTOCOL_FAILED");
  assert.equal(result.report.scenarioReports[2].firstFailure?.code,
    "FROZEN_ENTRY_CHILD_REBUILD_EVIDENCE_INVALID");
});

test("copy outputs, rebuild continuation and lifecycle records are independently reconciled", async () => {
  const version = workspaceSourceFingerprint(root);
  const { plan, nestedPlans } = dispatcherFixture(version);
  const runFixture = async (mutate) => executePlan(plan, version, nestedPlans, {
    build: async () => ({ exitCode: 0 }),
    run: async (_command, _args, { env }) => {
      const index = env.STEMMIO_FROZEN_SCENARIO_ID === "A" ? 0
        : env.STEMMIO_FROZEN_SCENARIO_ID === "B" ? 1 : 2;
      const report = passChildReport(env, version, nestedPlans[index]);
      mutate(report, env.STEMMIO_FROZEN_SCENARIO_ID);
      await writeFile(env.STEMMIO_FROZEN_REPORT_PATH, JSON.stringify(report));
      return { exitCode: 0, timedOut: false, signal: null, spawnError: null,
        cleanup: { attempted: false, confirmed: true, signal: null } };
    },
    print: false,
  });

  const wrongOutput = await runFixture((report, id) => {
    if (id !== "B") return;
    const forgedId = "sm1_eeeeeeeeeeee4eee8eeeeeeeeeeeeeee";
    report.mixed.copyIds[0] = forgedId;
  });
  assert.equal(wrongOutput.report.ledger[1].state, "FAIL");
  assert.equal(wrongOutput.report.scenarioReports[1].firstFailure?.code,
    "FROZEN_ENTRY_CHILD_OUTPUT_BINDING_MISMATCH");

  const wrongContinuation = await runFixture((report, id) => {
    if (id !== "C") return;
    const input = report.structureOperations.find((row) => row.operation === "input-restored");
    input.actual.id = "c-target";
  });
  assert.equal(wrongContinuation.report.ledger[2].state, "FAIL");
  assert.equal(wrongContinuation.report.scenarioReports[2].firstFailure?.code,
    "FROZEN_ENTRY_CHILD_REBUILD_CONTINUATION_INVALID");

  const truncatedLifecycle = await runFixture((report, id) => {
    if (id !== "C") return;
    report.lifecycle.records.pop();
  });
  assert.equal(truncatedLifecycle.report.ledger[2].state, "FAIL");
  assert.equal(truncatedLifecycle.report.scenarioReports[2].firstFailure?.code,
    "FROZEN_ENTRY_CHILD_LIFECYCLE_EVIDENCE_INVALID");
});

function publicStableId(letter) {
  return `sm1_${letter.repeat(12)}4${letter.repeat(3)}8${letter.repeat(15)}`;
}

async function createPublicScenarioFixture(directory, { fileId, scope, operation, version }) {
  const ids = {
    text: publicStableId("a"),
    structure: publicStableId("b"),
    sourceParent: publicStableId("c"),
    destinationParent: publicStableId("d"),
  };
  const runtimeScript = operation === "structure"
    ? "<script>document.body.dataset.publicRuntime = 'ready';</script>" : "";
  const template = `<!doctype html><html><head><meta charset="utf-8"><title>Public ${fileId}</title></head><body><div data-stemmio-id="${ids.sourceParent}"><p data-stemmio-id="${ids.text}">Public text target</p><p data-stemmio-id="${ids.structure}">Public structure target</p></div><div data-stemmio-id="${ids.destinationParent}"></div>${runtimeScript}</body></html>`;
  const materialized = materializeSourceElementIdentity(template);
  const html = Buffer.from(materialized.html, "utf8");
  const originalPath = path.join(directory, `${fileId}-original.html`);
  const seedPath = path.join(directory, `${fileId}-seed.html`);
  await Promise.all([writeFile(originalPath, html), writeFile(seedPath, html)]);
  const identity = { path: seedPath, sha256: createHash("sha256").update(html).digest("hex"), size: html.length };
  const byId = new Map(materialized.identity.elements.map((element) => [element.stemmioId, element]));
  const textElement = byId.get(ids.text);
  const structureElement = byId.get(ids.structure);
  const sourceParent = byId.get(ids.sourceParent);
  const destinationParent = byId.get(ids.destinationParent);
  const byteOffset = element => Buffer.byteLength(materialized.html.slice(0, element.contentEndOffset));
  const rawElement = element => Buffer.from(materialized.html.slice(element.startOffset, element.sourceEndOffset), "utf8");
  const structureBinding = {
    kind: "inserted-leaf-at-frozen-source-offset",
    parentId: ids.sourceParent,
    beforeSiblingId: null,
    byteOffset: byteOffset(sourceParent),
    originalElementSha256: frozenDigest(rawElement(structureElement)),
  };
  const textBinding = {
    kind: "inserted-leaf-at-frozen-source-offset",
    parentId: ids.destinationParent,
    beforeSiblingId: null,
    byteOffset: byteOffset(destinationParent),
    originalElementSha256: frozenDigest(rawElement(textElement)),
  };
  const textTarget = {
    clickId: ids.text, selectedId: ids.text, clickTag: "p", selectedTag: "p", mapping: "self",
    expectedCapability: "AVAILABLE", contractReason: "UNIQUE_REACHABLE_AUTHORED_TARGET", sourceProof: "REVIEWED_EXACT_SEED",
    tabId: null, scrollContainer: "document", textCapability: {
      expected: "AVAILABLE", basis: "SOURCE_EDITABLE_ISLAND", clickPoint: "first-direct-text-character",
    }, operations: [...FROZEN_FORMAT_OPERATIONS], textNodePath: [0], initialBold: false,
    historyAdoption: "editable-island-in-place", historyResume: "in-place", historyBasis: "REVIEWED_CANONICAL_ISLAND",
    formatCapability: { scope: "text-range", expected: "AVAILABLE", basis: "SOURCE_SAFE_TEXT_RANGE_WRAPPER" },
    copyBinding: textBinding,
  };
  const structureTarget = {
    clickId: ids.structure, selectedId: ids.structure, clickTag: "p", selectedTag: "p", mapping: "self",
    expectedCapability: "AVAILABLE", contractReason: "UNIQUE_REACHABLE_AUTHORED_TARGET", sourceProof: "REVIEWED_EXACT_SEED",
    tabId: null, scrollContainer: "document", copyCapability: {
      expected: "AVAILABLE", basis: "REVIEWED_SOURCE_EQUIVALENT_LEAF", reason: "available",
    }, textCapability: { expected: "AVAILABLE", basis: "SOURCE_EDITABLE_ISLAND_PLAIN_LEAF" },
    copyBinding: structureBinding, rebuildPath: "static-rebuild", continuationProbe: "session-ended-no-refocus",
    operations: [...FROZEN_STRUCTURE_PROBE_OPERATIONS],
  };
  let nested;
  if (scope === "core-three-cycle") {
    nested = {
      schemaVersion: 1, scope, reviewStatus: "FROZEN", reviewedBy: "root", fileId, initialRuntime: "static",
      operation, original: { ...identity, path: originalPath }, seed: identity, workspaceSourceSha256: version.workspaceSourceSha256,
      reopen: true, cycles: 3, textScope: "core-text-format", sourceEvolution: "verified-text-region",
      commentBasis: "EXACT_AUTHORED_SOURCE_ANCHOR", structurePrefixSha256: frozenDigest(html.subarray(0, structureBinding.byteOffset)),
      targets: [textTarget, structureTarget],
    };
  } else {
    nested = {
      schemaVersion: 1, scope, reviewStatus: "FROZEN", reviewedBy: "root", fileId, initialRuntime: "runtime",
      operation, original: { ...identity, path: originalPath }, seed: identity, workspaceSourceSha256: version.workspaceSourceSha256,
      reopen: true,
      targets: [{ ...structureTarget, continuationProbe: undefined,
        rebuildPath: "runtime-candidate", rebuildTrigger: "accepted-projection-failure",
        operations: [...FROZEN_STRUCTURE_CLOSED_LOOP_OPERATIONS], expectedProjection: "in-place",
        projectionByOperation: { copy: "in-place", "move-copy": "recovered" }, destinationParentId: ids.sourceParent,
        destinationBeforeElementId: ids.structure,
        initialBold: false, formatCapability: {
          expected: "AVAILABLE", scope: "element", basis: "SOURCE_ELEMENT_STYLE_NO_NEW_WRAPPER",
        } }],
    };
  }
  const bytes = Buffer.from(JSON.stringify(nested));
  const manifestPath = path.join(directory, `${fileId}.json`);
  await writeFile(manifestPath, bytes);
  return { manifestPath, manifestSha256: digestFrozenEntry(bytes), bytes, nested: readFrozenSelection(bytes, digestFrozenEntry(bytes)) };
}

test("public opt-in entry smoke traverses real A/B/C children and parent report protocol", {
  skip: process.env.STEMMIO_RUN_PUBLIC_FROZEN_ENTRY !== "1",
}, async () => {
  const version = workspaceSourceFingerprint(root);
  const directory = await mkdtemp(path.join(tmpdir(), "stemmio-public-frozen-entry-"));
  const id = `sm1_${"a".repeat(12)}4${"b".repeat(3)}8${"c".repeat(15)}`;
  const template = `<!doctype html><html><head><meta charset="utf-8"><title>Public frozen entry</title></head><body><p data-stemmio-id="${id}">Public entry target</p></body></html>`;
  let allocatedIdentity = 0;
  const materialized = materializeSourceElementIdentity(template, {
    randomUUIDFactory: () => `00000000-0000-4000-8000-${String(++allocatedIdentity).padStart(12, "0")}`,
  });
  const html = Buffer.from(materialized.html, "utf8");
  const originalPath = path.join(directory, "original.html");
  const seedPath = path.join(directory, "seed.html");
  const nestedPath = path.join(directory, "A.json");
  await Promise.all([writeFile(originalPath, html), writeFile(seedPath, html)]);
  const identity = {
    path: seedPath,
    sha256: createHash("sha256").update(html).digest("hex"),
    size: html.length,
  };
  const nested = {
    schemaVersion: 1,
    scope: "core-text-format",
    reviewStatus: "FROZEN",
    reviewedBy: "root",
    fileId: "H99",
    initialRuntime: "static",
    operation: "native-text",
    original: { ...identity, path: originalPath },
    seed: identity,
    workspaceSourceSha256: version.workspaceSourceSha256,
    reopen: true,
    targets: [{
      clickId: id,
      selectedId: id,
      clickTag: "p",
      selectedTag: "p",
      mapping: "self",
      expectedCapability: "AVAILABLE",
      contractReason: "UNIQUE_REACHABLE_AUTHORED_TARGET",
      sourceProof: "REVIEWED_EXACT_SEED",
      tabId: null,
      scrollContainer: "document",
      textCapability: {
        expected: "AVAILABLE",
        basis: "SOURCE_EDITABLE_ISLAND",
        clickPoint: "first-direct-text-character",
      },
      operations: [...FROZEN_FORMAT_OPERATIONS],
      textNodePath: [0],
      initialBold: false,
      historyAdoption: "editable-island-in-place",
      historyResume: "in-place",
      historyBasis: "REVIEWED_CANONICAL_ISLAND",
      formatCapability: {
        scope: "text-range",
        expected: "AVAILABLE",
        basis: "SOURCE_SAFE_TEXT_RANGE_WRAPPER",
      },
    }],
  };
  const nestedBytes = Buffer.from(JSON.stringify(nested));
  await writeFile(nestedPath, nestedBytes);
  const nestedDigest = digestFrozenEntry(nestedBytes);
  const bFixture = await createPublicScenarioFixture(directory, {
    fileId: "H97", scope: "core-three-cycle", operation: "mixed", version,
  });
  const cFixture = await createPublicScenarioFixture(directory, {
    fileId: "H98", scope: "core-structure-closed-loop", operation: "structure", version,
  });
  const fixture = dispatcherFixture(version);
  const plan = {
    ...fixture.plan,
    scenarios: fixture.plan.scenarios.map((scenario, index) => [
      { ...scenario, scope: "core-text-format", manifestPath: nestedPath, manifestSha256: nestedDigest },
      { ...scenario, scope: "core-three-cycle", manifestPath: bFixture.manifestPath, manifestSha256: bFixture.manifestSha256 },
      { ...scenario, scope: "core-structure-closed-loop", manifestPath: cFixture.manifestPath, manifestSha256: cFixture.manifestSha256 },
    ][index]),
  };
  const nestedPlans = [readFrozenSelection(nestedBytes, nestedDigest), bFixture.nested, cFixture.nested];
  const result = await executePlan(plan, version, nestedPlans, {
    build: () => ensureRendererBuilt(),
    run: async (command, args, options) => {
      return runCommand(command, args, options);
    },
    scenarioTimeoutMs: 180_000,
    print: false,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.report.ledger.map(({ id: scenarioId, state }) => [scenarioId, state]), [
    ["A", "PASS"], ["B", "PASS"], ["C", "PASS"],
  ]);
  assert.equal(result.report.scenarioReports[0].evidence.operationCount, FROZEN_FORMAT_OPERATIONS.length + 1);
  assert.equal(result.report.scenarioReports[1].evidence.operationCount > 0, true);
  assert.equal(result.report.scenarioReports[2].evidence.operationCount > 0, true);
  assert.equal(result.report.scenarioReports[0].process.cleanup.confirmed, true);
  assert.ok(result.report.scenarioReports[0].process.stdoutPath.endsWith("/A/child.stdout.log"));
});

test("a failed or timed-out B retains first failure and does not prevent C", async () => {
  for (const mode of ["failure", "timeout"]) {
    const version = workspaceSourceFingerprint(root);
    const { plan, nestedPlans } = dispatcherFixture(version);
    const result = await executePlan(plan, version, nestedPlans, {
      build: async () => ({ exitCode: 0 }),
      run: async (_command, _args, { env }) => {
        if (env.STEMMIO_FROZEN_SCENARIO_ID === "B" && mode === "timeout") {
          return { exitCode: null, signal: "SIGTERM", timedOut: true, spawnError: null,
            cleanup: { attempted: true, confirmed: true, signal: "SIGKILL" } };
        }
        if (env.STEMMIO_FROZEN_SCENARIO_ID === "B") {
          await writeFile(env.STEMMIO_FROZEN_REPORT_PATH, JSON.stringify({
            ...passChildReport(env, version, nestedPlans[1]), state: "FAIL",
            firstFailure: { code: "FIXTURE_FIRST_FAILURE", step: "input" }, cleanup: "PASS",
          }));
          return { exitCode: 1, signal: null, timedOut: false, spawnError: null,
            cleanup: { attempted: false, confirmed: true, signal: null } };
        }
        await writeFile(env.STEMMIO_FROZEN_REPORT_PATH, JSON.stringify(passChildReport(
          env, version, nestedPlans[env.STEMMIO_FROZEN_SCENARIO_ID === "A" ? 0 : 2],
        )));
        return { exitCode: 0, signal: null, timedOut: false, spawnError: null,
          cleanup: { attempted: false, confirmed: true, signal: null } };
      },
      print: false,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.ledger[1].state, "FAIL");
    assert.equal(result.report.ledger[2].state, "PASS");
    assert.equal(result.report.scenarioReports[1].firstFailure?.code, mode === "timeout" ? "CHILD_TIMEOUT" : "FIXTURE_FIRST_FAILURE");
  }
});

test("an unconfirmed process-group cleanup blocks later scenarios as an environment failure", async () => {
  const version = workspaceSourceFingerprint(root);
  const { plan, nestedPlans } = dispatcherFixture(version);
  const calls = [];
  const result = await executePlan(plan, version, nestedPlans, {
    build: async () => ({ exitCode: 0 }),
    run: async (_command, _args, { env }) => {
      calls.push(env.STEMMIO_FROZEN_SCENARIO_ID);
      const index = env.STEMMIO_FROZEN_SCENARIO_ID === "A" ? 0 : 1;
      await writeFile(env.STEMMIO_FROZEN_REPORT_PATH, JSON.stringify(passChildReport(env, version, nestedPlans[index])));
      return {
        exitCode: 0, signal: null, timedOut: false, spawnError: null,
        cleanup: env.STEMMIO_FROZEN_SCENARIO_ID === "B"
          ? { attempted: true, confirmed: false, signal: "SIGKILL" }
          : { attempted: false, confirmed: true, signal: null },
      };
    },
    print: false,
  });
  assert.deepEqual(calls, ["A", "B"]);
  assert.deepEqual(result.report.ledger.map(({ id, state, reason }) => [id, state, reason]), [
    ["A", "PASS", "SCENARIO_COMPLETED"],
    ["B", "NOT_EXECUTED", "ENVIRONMENT_BLOCKED"],
    ["C", "NOT_EXECUTED", "ENVIRONMENT_BLOCKED"],
  ]);
  assert.equal(result.report.scenarioReports[2].firstFailure?.code, "FROZEN_ENTRY_PROCESS_CLEANUP_UNCONFIRMED");
});

test("zero exit with a missing or incomplete report cannot become PASS", async () => {
  const version = workspaceSourceFingerprint(root);
  const { plan, nestedPlans } = dispatcherFixture(version);
  const result = await executePlan(plan, version, nestedPlans, {
    build: async () => ({ exitCode: 0 }),
    run: async (_command, _args, { env }) => {
      if (env.STEMMIO_FROZEN_SCENARIO_ID === "B") return { exitCode: 0, timedOut: false, signal: null, spawnError: null,
        cleanup: { attempted: false, confirmed: true, signal: null } };
      await writeFile(env.STEMMIO_FROZEN_REPORT_PATH, JSON.stringify(passChildReport(
        env, version, nestedPlans[env.STEMMIO_FROZEN_SCENARIO_ID === "A" ? 0 : 2],
        { incomplete: env.STEMMIO_FROZEN_SCENARIO_ID === "A" },
      )));
      return { exitCode: 0, timedOut: false, signal: null, spawnError: null,
        cleanup: { attempted: false, confirmed: true, signal: null } };
    },
    print: false,
  });
  assert.equal(result.report.ledger[0].state, "FAIL");
  assert.equal(result.report.ledger[1].reason, "CHILD_REPORT_MISSING");
  assert.equal(result.report.ledger[2].state, "PASS");
});

test("a child report from another invocation cannot be associated with the current scenario", async () => {
  const version = workspaceSourceFingerprint(root);
  const { plan, nestedPlans } = dispatcherFixture(version);
  const result = await executePlan(plan, version, nestedPlans, {
    build: async () => ({ exitCode: 0 }),
    run: async (_command, _args, { env }) => {
      const report = passChildReport(
        env,
        version,
        nestedPlans[env.STEMMIO_FROZEN_SCENARIO_ID === "A" ? 0 : env.STEMMIO_FROZEN_SCENARIO_ID === "B" ? 1 : 2],
      );
      if (env.STEMMIO_FROZEN_SCENARIO_ID === "A") {
        report.reportPath = "/tmp/stale-result.json";
        report.reportDirectory = "/tmp";
      }
      await writeFile(env.STEMMIO_FROZEN_REPORT_PATH, JSON.stringify(report));
      return { exitCode: 0, timedOut: false, signal: null, spawnError: null,
        cleanup: { attempted: false, confirmed: true, signal: null } };
    },
    print: false,
  });
  assert.equal(result.report.ledger[0].state, "FAIL");
  assert.equal(result.report.ledger[0].reason, "CHILD_REPORT_PROTOCOL_FAILED");
  assert.equal(result.report.ledger[1].state, "PASS");
  assert.equal(result.report.ledger[2].state, "PASS");
});

test("renderer build failure marks every scenario NOT_EXECUTED", async () => {
  const version = workspaceSourceFingerprint(root);
  const { plan, nestedPlans } = dispatcherFixture(version);
  const result = await executePlan(plan, version, nestedPlans, {
    build: async () => { throw Object.assign(new Error("build unavailable"), { code: "FIXTURE_BUILD_FAILED" }); },
    run: async () => { throw new Error("child must not start"); },
    print: false,
  });
  assert.deepEqual(result.report.ledger.map(({ state, reason }) => [state, reason]), [
    ["NOT_EXECUTED", "ENVIRONMENT_BLOCKED"],
    ["NOT_EXECUTED", "ENVIRONMENT_BLOCKED"],
    ["NOT_EXECUTED", "ENVIRONMENT_BLOCKED"],
  ]);
  assert.equal(result.report.scenarioReports.length, 3);
  assert.ok(result.report.scenarioReports.every(({ evidence, process, firstFailure }) => (
    evidence === null && process === null && firstFailure?.code === "FIXTURE_BUILD_FAILED"
  )));
});

test("direct node invocation uses the npm executable when npm_execpath is absent", async () => {
  const previous = process.env.npm_execpath;
  delete process.env.npm_execpath;
  let invocation;
  try {
    await ensureRendererBuilt({ run: async (command, args) => {
      invocation = { command, args };
      return { exitCode: 0, timedOut: false, spawnError: null,
        cleanup: { attempted: false, confirmed: true, signal: null } };
    } });
  } finally {
    if (previous === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = previous;
  }
  assert.equal(invocation.command, process.platform === "win32" ? "npm.cmd" : "npm");
  assert.deepEqual(invocation.args, ["run", "desktop:renderer"]);
});

test("direct node invocation uses npm_execpath when npm launched the entry", async () => {
  const previous = process.env.npm_execpath;
  process.env.npm_execpath = "/tmp/fake-npm-cli.js";
  let invocation;
  try {
    await ensureRendererBuilt({ run: async (command, args) => {
      invocation = { command, args };
      return { exitCode: 0, timedOut: false, spawnError: null,
        cleanup: { attempted: false, confirmed: true, signal: null } };
    } });
  } finally {
    if (previous === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = previous;
  }
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, ["/tmp/fake-npm-cli.js", "run", "desktop:renderer"]);
});

test("renderer build requires an explicit cleanup receipt", async () => {
  await assert.rejects(() => ensureRendererBuilt({ run: async () => ({
    exitCode: 0, timedOut: false, spawnError: null,
    cleanup: { attempted: true, confirmed: false, signal: "SIGKILL" },
  }) }), { code: "FROZEN_ENTRY_RENDERER_BUILD_FAILED" });
});

test("bounded child execution terminates a hung process without waiting indefinitely", async () => {
  const started = Date.now();
  const result = await runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], {
    timeoutMs: 50,
  });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
  assert.ok(Date.now() - started < 2_000);
});

test("bounded child execution waits for the owned process group after the parent closes", async () => {
  const result = await runCommand(process.execPath, ["-e", [
    "const { spawn } = require('node:child_process');",
    "spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"], { stdio: 'ignore' });",
    "setTimeout(() => {}, 10000);",
  ].join(" ")], { timeoutMs: 50 });
  assert.equal(result.timedOut, true);
  assert.equal(result.cleanup?.confirmed, true);
});

test("child output keeps a bounded summary while preserving complete per-scenario logs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "stemmio-frozen-output-"));
  const result = await runCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(40000))"], {
    timeoutMs: 1_000,
    outputDirectory: directory,
    printOutput: false,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, 32 * 1024);
  assert.equal((await readFile(result.stdoutPath, "utf8")).length, 40_000);
  assert.equal(result.cleanup?.confirmed, true);
});

test("child spawn errors are reported without waiting for the scenario timeout", async () => {
  const result = await runCommand("/definitely/missing/stemmio-child", [], { timeoutMs: 100 });
  assert.equal(result.timedOut, false);
  assert.equal(result.exitCode, null);
  assert.equal(result.spawnError?.code, "ENOENT");
});

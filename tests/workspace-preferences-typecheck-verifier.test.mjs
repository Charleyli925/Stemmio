import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  loadWorkspacePreferencesTypecheckConfig,
  verifyWorkspacePreferencesTypecheck,
} from "../scripts/verify-workspace-preferences-typecheck.mjs";
import { interpretWorkspacePreferenceMutation } from "../app/application/workspace-preference-mutation-outcome.js";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(productRoot, "app/application/workspace-preferences-session.js");
const consumerPath = path.join(
  productRoot,
  "app/application/workspace-preference-mutation-outcome.js",
);

test("the official WorkspacePreferences config checks production JavaScript mutations", () => {
  const result = verifyWorkspacePreferencesTypecheck();
  assert.equal(result.sourcePath, sourcePath);
  assert.equal(result.consumerPath, consumerPath);
  assert.deepEqual(result.diagnosticCodes, [2322, 2322, 2322, 2322]);
});

test("the proof fails if JavaScript checking or the production input is removed", () => {
  const parsedConfig = loadWorkspacePreferencesTypecheckConfig();
  assert.throws(
    () => verifyWorkspacePreferencesTypecheck({
      parsedConfig: { ...parsedConfig, options: { ...parsedConfig.options, checkJs: false } },
    }),
    /must enable allowJs and checkJs/u,
  );
  assert.throws(
    () => verifyWorkspacePreferencesTypecheck({
      parsedConfig: {
        ...parsedConfig,
        fileNames: parsedConfig.fileNames.filter(
          (fileName) => path.resolve(fileName) !== sourcePath,
        ),
      },
    }),
    /implementation is missing from the official compiler inputs/u,
  );
  assert.throws(
    () => verifyWorkspacePreferencesTypecheck({
      parsedConfig: {
        ...parsedConfig,
        fileNames: parsedConfig.fileNames.filter(
          (fileName) => path.resolve(fileName) !== consumerPath,
        ),
      },
    }),
    /consumer is missing from the official compiler inputs/u,
  );
});

test("the proof rejects missing and ambiguous mutation anchors", async () => {
  const sourceText = await readFile(sourcePath, "utf8");
  const anchor = 'return Object.freeze({ status: "committed", intentId, persistence: "confirmed" });';
  assert.throws(
    () => verifyWorkspacePreferencesTypecheck({ sourceText: sourceText.replace(anchor, "") }),
    /mutation anchor must match exactly once; matched 0/u,
  );
  assert.throws(
    () => verifyWorkspacePreferencesTypecheck({ sourceText: `${sourceText}\n${anchor}\n` }),
    /mutation anchor must match exactly once; matched 2/u,
  );
});

test("the production interpreter preserves every exact mutation disposition", () => {
  assert.deepEqual(interpretWorkspacePreferenceMutation({
    status: "committed",
    intentId: "committed",
    persistence: "confirmed",
  }), { kind: "committed", errorCode: null });
  assert.deepEqual(interpretWorkspacePreferenceMutation({
    status: "superseded",
    intentId: "superseded",
    rollback: "not-needed",
  }), { kind: "superseded", errorCode: null });
  assert.deepEqual(interpretWorkspacePreferenceMutation({
    status: "unknown",
    intentId: "unknown",
    phase: "rollback",
    pending: true,
  }), { kind: "unknown", errorCode: "AGENT_PREFERENCES_SAVE_UNKNOWN" });
  assert.deepEqual(interpretWorkspacePreferenceMutation({
    status: "failed",
    intentId: "failed",
    phase: "commit",
    persistence: "not-written",
  }), { kind: "failed", errorCode: "AGENT_PREFERENCES_SAVE_FAILED" });
});

test("RunWorkflow and AgentCatalog delegate intent receipts without a boolean fallback", async () => {
  const [runWorkflow, agentCatalog] = await Promise.all([
    readFile(path.join(productRoot, "app/application/run-workflow.js"), "utf8"),
    readFile(path.join(productRoot, "app/application/agent-provider-catalog.js"), "utf8"),
  ]);
  assert.match(runWorkflow, /interpretWorkspacePreferenceMutation\(saved\)/u);
  assert.match(runWorkflow, /interpretWorkspacePreferenceMutation\(receipt\)/u);
  assert.doesNotMatch(runWorkflow, /saved\.status|receipt\.status/u);
  assert.match(agentCatalog, /commitAgentConfigurations\(agentConfigurations, intent\)/u);
  assert.match(agentCatalog, /interpretWorkspacePreferenceMutation\(result\)/u);
  assert.doesNotMatch(
    agentCatalog,
    /result === true \|\| result\?\.status === "committed"/u,
  );
});

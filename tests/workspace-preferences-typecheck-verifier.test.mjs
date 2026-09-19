import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  loadWorkspacePreferencesTypecheckConfig,
  verifyWorkspacePreferencesTypecheck,
} from "../scripts/verify-workspace-preferences-typecheck.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(productRoot, "app/application/workspace-preferences-session.js");

test("the official WorkspacePreferences config checks production JavaScript mutations", () => {
  const result = verifyWorkspacePreferencesTypecheck();
  assert.equal(result.sourcePath, sourcePath);
  assert.deepEqual(result.diagnosticCodes, [2322, 2322, 2322]);
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

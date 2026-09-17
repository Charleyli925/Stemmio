import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  loadSourceReceiptTypecheckConfig,
  verifySourceReceiptTypecheck,
} from "../scripts/verify-source-receipt-typecheck.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(productRoot, "app/application/source-receipt.js");

test("the official SourceReceipt config rejects the implementation mutation", () => {
  const result = verifySourceReceiptTypecheck();
  assert.equal(result.sourcePath, sourcePath);
  assert.equal(result.diagnosticCode, 2322);
});

test("the proof fails if the official config stops checking JavaScript", () => {
  const parsedConfig = loadSourceReceiptTypecheckConfig();
  assert.throws(
    () => verifySourceReceiptTypecheck({
      parsedConfig: {
        ...parsedConfig,
        options: { ...parsedConfig.options, checkJs: false },
      },
    }),
    /official SourceReceipt config must enable allowJs and checkJs/u,
  );
});

test("the proof fails if the implementation leaves the official compiler inputs", () => {
  const parsedConfig = loadSourceReceiptTypecheckConfig();
  assert.throws(
    () => verifySourceReceiptTypecheck({
      parsedConfig: {
        ...parsedConfig,
        fileNames: parsedConfig.fileNames.filter((fileName) => path.resolve(fileName) !== sourcePath),
      },
    }),
    /implementation is missing from the official compiler inputs/u,
  );
});

test("the proof fails when the mutation location is absent or ambiguous", async () => {
  const sourceText = await readFile(sourcePath, "utf8");
  const anchor = "sessionIncarnation: revision(input.sessionIncarnation),";
  assert.throws(
    () => verifySourceReceiptTypecheck({ sourceText: sourceText.replace(anchor, "") }),
    /mutation anchor must match exactly once; matched 0/u,
  );
  assert.throws(
    () => verifySourceReceiptTypecheck({ sourceText: `${sourceText}\n${anchor}\n` }),
    /mutation anchor must match exactly once; matched 2/u,
  );
});

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
const documentSessionSourcePath = path.join(
  productRoot,
  "app/application/document-session.js",
);
const documentSessionContractPath = path.join(
  productRoot,
  "app/application/document-session-contract.d.ts",
);
const documentSessionFacadePath = path.join(
  productRoot,
  "app/application/document-session.d.ts",
);

test("the official SourceReceipt config rejects the implementation mutation", () => {
  const result = verifySourceReceiptTypecheck();
  assert.equal(result.sourcePath, sourcePath);
  assert.equal(result.documentSessionSourcePath, documentSessionSourcePath);
  assert.equal(result.documentSessionContractPath, documentSessionContractPath);
  assert.equal(result.documentSessionFacadePath, documentSessionFacadePath);
  assert.equal(result.diagnosticCode, 2322);
  assert.equal(result.surfaceContextDiagnosticCode, 2322);
  assert.deepEqual(
    result.documentSessionDiagnosticCodes,
    [2322, 2322, 2322, 2420, 2416, 2416],
  );
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
    /required input is missing from the official compiler inputs/u,
  );
});

test("the proof fails if DocumentSession leaves the official compiler inputs", () => {
  const parsedConfig = loadSourceReceiptTypecheckConfig();
  assert.throws(
    () => verifySourceReceiptTypecheck({
      parsedConfig: {
        ...parsedConfig,
        fileNames: parsedConfig.fileNames.filter(
          (fileName) => path.resolve(fileName) !== documentSessionSourcePath,
        ),
      },
    }),
    /required input is missing from the official compiler inputs.*document-session\.js/u,
  );
});

for (const [name, requiredPath] of [
  ["DocumentSession contract", documentSessionContractPath],
  ["DocumentSession facade", documentSessionFacadePath],
]) {
  test(`the proof fails if the ${name} leaves the official compiler inputs`, () => {
    const parsedConfig = loadSourceReceiptTypecheckConfig();
    assert.throws(
      () => verifySourceReceiptTypecheck({
        parsedConfig: {
          ...parsedConfig,
          fileNames: parsedConfig.fileNames.filter(
            (fileName) => path.resolve(fileName) !== requiredPath,
          ),
        },
      }),
      /required input is missing from the official compiler inputs/u,
    );
  });
}

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

test("the proof fails when a DocumentSession mutation location is absent or ambiguous", async () => {
  const sourceText = await readFile(documentSessionSourcePath, "utf8");
  const anchor = "renderedSha256: String(renderedSha256 || \"\"),";
  assert.throws(
    () => verifySourceReceiptTypecheck({
      documentSessionSourceText: sourceText.replace(anchor, ""),
    }),
    /verified-rendered-hash mutation anchor must match exactly once; matched 0/u,
  );
  assert.throws(
    () => verifySourceReceiptTypecheck({
      documentSessionSourceText: `${sourceText}\n${anchor}\n`,
    }),
    /verified-rendered-hash mutation anchor must match exactly once; matched 2/u,
  );
});

test("the proof fails if DocumentSession drops its complete instance contract", async () => {
  const sourceText = await readFile(documentSessionSourcePath, "utf8");
  const implementsContract = "/** @implements {DocumentSessionDeclaration} */";
  assert.throws(
    () => verifySourceReceiptTypecheck({
      documentSessionSourceText: sourceText.replace(implementsContract, ""),
    }),
    /DocumentSession @implements contract must match exactly once; matched 0/u,
  );
});

test("the complete-instance mutation anchor must remain unique", async () => {
  const sourceText = await readFile(documentSessionSourcePath, "utf8");
  const start = sourceText.indexOf("  markPersistenceIdle() {");
  const end = sourceText.indexOf(
    "\n\n  /** @param {Partial<Parameters<DocumentSessionDeclaration[\"recordPersistenceFailure\"]",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const anchor = sourceText.slice(start, end);
  assert.throws(
    () => verifySourceReceiptTypecheck({
      documentSessionSourceText: sourceText.replace(anchor, ""),
    }),
    /complete-instance-contract mutation anchor must match exactly once; matched 0/u,
  );
  assert.throws(
    () => verifySourceReceiptTypecheck({
      documentSessionSourceText: `${sourceText}\n${anchor}\n`,
    }),
    /complete-instance-contract mutation anchor must match exactly once; matched 2/u,
  );
});


test("the proof fails if the surface context implementation leaves compiler inputs", () => {
  const parsedConfig = loadSourceReceiptTypecheckConfig();
  assert.throws(() => verifySourceReceiptTypecheck({
    parsedConfig: {
      ...parsedConfig,
      fileNames: parsedConfig.fileNames.filter((fileName) => !fileName.endsWith("/project-surface-context.js")),
    },
  }), /Surface context required input is missing/u);
});

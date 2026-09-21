import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import {
  assertOfficialJavaScriptInputs,
  loadOfficialTypecheckConfig,
  mutateExactly,
  verifyImplementationMutations,
} from "./typecheck-mutation-verifier.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultConfigPath = path.join(productRoot, "tsconfig.source-receipt.json");
const defaultSourcePath = path.join(productRoot, "app/application/source-receipt.js");
const defaultDocumentSessionSourcePath = path.join(
  productRoot,
  "app/application/document-session.js",
);
const defaultDocumentSessionContractPath = path.join(
  productRoot,
  "app/application/document-session-contract.d.ts",
);
const defaultDocumentSessionFacadePath = path.join(
  productRoot,
  "app/application/document-session.d.ts",
);
const implementationContractAnchor = "/** @implements {DocumentSessionDeclaration} */";
const mutationAnchor = "sessionIncarnation: revision(input.sessionIncarnation),";
const mutatedAssignment = "sessionIncarnation: String(input.sessionIncarnation),";
const documentSessionMutations = Object.freeze([
  Object.freeze({
    name: "verified-rendered-hash",
    anchor: "renderedSha256: String(renderedSha256 || \"\"),",
    replacement: "renderedSha256: null,",
    diagnosticCode: 2322,
    diagnosticFragment: "Type 'null' is not assignable to type 'string'",
  }),
  Object.freeze({
    name: "verified-generation",
    anchor: [
      "status: \"verified\",",
      "      generation: normalizedGeneration,",
      "      renderedSha256: String(renderedSha256 || \"\"),",
    ].join("\n"),
    replacement: [
      "status: \"verified\",",
      "      generation: String(normalizedGeneration),",
      "      renderedSha256: String(renderedSha256 || \"\"),",
    ].join("\n"),
    diagnosticCode: 2322,
    diagnosticFragment: "Type 'string' is not assignable to type 'number'",
  }),
  Object.freeze({
    name: "accepted-edit-result",
    anchor: [
      "accepted: true,",
      "      revision: nextRevision,",
      "      write,",
    ].join("\n"),
    replacement: [
      "accepted: \"yes\",",
      "      revision: nextRevision,",
      "      write,",
    ].join("\n"),
    diagnosticCode: 2322,
    diagnosticFragment: "Type '\"yes\"' is not assignable to type 'true'",
  }),
  Object.freeze({
    name: "complete-instance-contract",
    anchor: [
      "  markPersistenceIdle() {",
      "    if (",
      "      this.#pendingWrite",
      "      || this.#activeWrite",
      "      || this.#snapshot.lastPersistedRevision < this.#snapshot.editRevision",
      "      || this.#snapshot.persistState === \"failed\"",
      "      || this.#snapshot.persistState === \"conflict\"",
      "      || (",
      "        this.#snapshot.workingHtmlSha256",
      "        && this.#snapshot.workingHtmlSha256 !== this.#snapshot.persistedSourceSha256",
      "      )",
      "    ) return false;",
      "    this.#emit({",
      "      ...this.#snapshot,",
      "      persistState: \"idle\",",
      "      persistError: \"\",",
      "    });",
      "    return true;",
      "  }",
    ].join("\n"),
    replacement: "",
    diagnosticCode: 2420,
    diagnosticFragment: "Property 'markPersistenceIdle' is missing",
  }),
  Object.freeze({
    name: "canvas-authority-getter",
    anchor: [
      "  get canvasAuthority() {",
      "    return this.#snapshot.canvasAuthority;",
      "  }",
    ].join("\n"),
    replacement: [
      "  get canvasAuthority() {",
      "    return \"invalid-canvas-authority\";",
      "  }",
    ].join("\n"),
    diagnosticCode: 2416,
    diagnosticFragment: "Property 'canvasAuthority' in type 'DocumentSession' is not assignable",
  }),
  Object.freeze({
    name: "flush-promise-getter",
    anchor: [
      "  get flushPromise() {",
      "    return this.#flushPromise;",
      "  }",
    ].join("\n"),
    replacement: [
      "  get flushPromise() {",
      "    return \"invalid-flush-promise\";",
      "  }",
    ].join("\n"),
    diagnosticCode: 2416,
    diagnosticFragment: "Property 'flushPromise' in type 'DocumentSession' is not assignable",
  }),
]);

export function loadSourceReceiptTypecheckConfig(configPath = defaultConfigPath) {
  return loadOfficialTypecheckConfig({ configPath, subject: "SourceReceipt" });
}

function assertImplementationContract(sourceText) {
  const matchCount = sourceText.split(implementationContractAnchor).length - 1;
  if (matchCount !== 1) {
    throw new Error(`DocumentSession @implements contract must match exactly once; matched ${matchCount}`);
  }
}

export function verifySourceReceiptTypecheck({
  parsedConfig = loadSourceReceiptTypecheckConfig(),
  sourcePath = defaultSourcePath,
  sourceText = ts.sys.readFile(sourcePath),
  documentSessionSourcePath = defaultDocumentSessionSourcePath,
  documentSessionSourceText = ts.sys.readFile(documentSessionSourcePath),
  documentSessionContractPath = defaultDocumentSessionContractPath,
  documentSessionFacadePath = defaultDocumentSessionFacadePath,
} = {}) {
  const resolvedSourcePath = path.resolve(sourcePath);
  const resolvedDocumentSessionSourcePath = path.resolve(documentSessionSourcePath);
  const requiredInputs = [
    { path: resolvedSourcePath, description: "SourceReceipt required input" },
    { path: resolvedDocumentSessionSourcePath, description: "SourceReceipt required input" },
    { path: documentSessionContractPath, description: "SourceReceipt required input" },
    { path: documentSessionFacadePath, description: "SourceReceipt required input" },
  ];
  assertOfficialJavaScriptInputs({ parsedConfig, subject: "SourceReceipt", requiredInputs });
  if (typeof sourceText !== "string") {
    throw new Error(`cannot read SourceReceipt implementation: ${resolvedSourcePath}`);
  }
  if (typeof documentSessionSourceText !== "string") {
    throw new Error(`cannot read DocumentSession implementation: ${resolvedDocumentSessionSourcePath}`);
  }
  assertImplementationContract(documentSessionSourceText);
  const receiptMutation = {
    name: "SourceReceipt",
    anchor: mutationAnchor,
    replacement: mutatedAssignment,
    diagnosticCode: 2322,
    diagnosticFragment: "Type 'string' is not assignable to type 'number'",
  };
  mutateExactly(sourceText, receiptMutation);
  for (const mutation of documentSessionMutations) {
    mutateExactly(documentSessionSourceText, mutation);
  }

  const receiptMutationCase = {
    ...receiptMutation,
    sourcePath: resolvedSourcePath,
    sourceText,
  };
  const documentSessionMutationCases = documentSessionMutations.map((mutation) => ({
    ...mutation,
    sourcePath: resolvedDocumentSessionSourcePath,
    sourceText: documentSessionSourceText,
  }));
  const [receiptDiagnostic, ...documentSessionDiagnostics] = verifyImplementationMutations({
    parsedConfig,
    subject: "SourceReceipt",
    requiredInputs,
    sourceOverrides: new Map([
      [resolvedSourcePath, sourceText],
      [resolvedDocumentSessionSourcePath, documentSessionSourceText],
    ]),
    mutations: [receiptMutationCase, ...documentSessionMutationCases],
  });
  return Object.freeze({
    configPath: parsedConfig.options.configFilePath || defaultConfigPath,
    sourcePath: resolvedSourcePath,
    documentSessionSourcePath: resolvedDocumentSessionSourcePath,
    documentSessionContractPath: path.resolve(documentSessionContractPath),
    documentSessionFacadePath: path.resolve(documentSessionFacadePath),
    diagnosticCode: receiptDiagnostic.code,
    documentSessionDiagnosticCodes: Object.freeze(
      documentSessionDiagnostics.map((diagnostic) => diagnostic.code),
    ),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = verifySourceReceiptTypecheck();
  process.stdout.write(
    `SourceReceipt and DocumentSession implementation mutations rejected by official config (TS${result.diagnosticCode}; ${result.documentSessionDiagnosticCodes.map((code) => `TS${code}`).join(", ")}).\n`,
  );
}

import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

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

function diagnosticMessage(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
}

function formatDiagnostics(diagnostics) {
  return diagnostics.map((diagnostic) => {
    const file = diagnostic.file?.fileName || "<configuration>";
    if (!diagnostic.file || typeof diagnostic.start !== "number") {
      return `${file}: TS${diagnostic.code} ${diagnosticMessage(diagnostic)}`;
    }
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return `${file}:${position.line + 1}:${position.character + 1}: TS${diagnostic.code} ${diagnosticMessage(diagnostic)}`;
  }).join("\n");
}

export function loadSourceReceiptTypecheckConfig(configPath = defaultConfigPath) {
  const resolvedConfigPath = path.resolve(configPath);
  const loaded = ts.readConfigFile(resolvedConfigPath, ts.sys.readFile);
  if (loaded.error) {
    throw new Error(`cannot read the official SourceReceipt typecheck config:\n${formatDiagnostics([loaded.error])}`);
  }
  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    path.dirname(resolvedConfigPath),
    undefined,
    resolvedConfigPath,
  );
  if (parsed.errors.length > 0) {
    throw new Error(`cannot parse the official SourceReceipt typecheck config:\n${formatDiagnostics(parsed.errors)}`);
  }
  return parsed;
}

function programFor({ parsedConfig, sourceOverrides = new Map() }) {
  const resolvedOverrides = new Map(
    [...sourceOverrides].map(([sourcePath, sourceText]) => [path.resolve(sourcePath), sourceText]),
  );
  const host = ts.createCompilerHost(parsedConfig.options, true);
  const defaultReadFile = host.readFile.bind(host);
  host.readFile = (fileName) => (
    resolvedOverrides.has(path.resolve(fileName))
      ? resolvedOverrides.get(path.resolve(fileName))
      : defaultReadFile(fileName)
  );
  host.getSourceFile = (fileName, languageVersion, onError) => {
    const text = host.readFile(fileName);
    if (text === undefined) {
      onError?.(`cannot read ${fileName}`);
      return undefined;
    }
    return ts.createSourceFile(
      fileName,
      text,
      languageVersion,
      true,
      ts.getScriptKindFromFileName(fileName),
    );
  };
  return ts.createProgram({
    rootNames: parsedConfig.fileNames,
    options: parsedConfig.options,
    projectReferences: parsedConfig.projectReferences,
    host,
  });
}

function assertOfficialImplementationCheck(parsedConfig, sourcePaths) {
  if (parsedConfig.options.allowJs !== true || parsedConfig.options.checkJs !== true) {
    throw new Error("official SourceReceipt config must enable allowJs and checkJs");
  }
  const officialInputs = new Set(parsedConfig.fileNames.map((fileName) => path.resolve(fileName)));
  for (const sourcePath of sourcePaths) {
    const resolvedSourcePath = path.resolve(sourcePath);
    if (!officialInputs.has(resolvedSourcePath)) {
      throw new Error(`SourceReceipt required input is missing from the official compiler inputs: ${resolvedSourcePath}`);
    }
  }
}

function assertProgramInputs(program, sourcePaths) {
  for (const sourcePath of sourcePaths) {
    const resolvedSourcePath = path.resolve(sourcePath);
    if (!program.getSourceFile(resolvedSourcePath)) {
      throw new Error(`official SourceReceipt program did not load required input: ${resolvedSourcePath}`);
    }
  }
}

function assertImplementationContract(sourceText) {
  const matchCount = sourceText.split(implementationContractAnchor).length - 1;
  if (matchCount !== 1) {
    throw new Error(`DocumentSession @implements contract must match exactly once; matched ${matchCount}`);
  }
}

function mutateExactly(sourceText, { name, anchor, replacement }) {
  const matchCount = sourceText.split(anchor).length - 1;
  if (matchCount !== 1) {
    throw new Error(`${name} mutation anchor must match exactly once; matched ${matchCount}`);
  }
  return sourceText.replace(anchor, replacement);
}

function mutationDiagnostic({
  parsedConfig,
  sourcePath,
  sourceText,
  mutation,
}) {
  const mutatedSource = mutateExactly(sourceText, mutation);
  const program = programFor({
    parsedConfig,
    sourceOverrides: new Map([[sourcePath, mutatedSource]]),
  });
  assertProgramInputs(program, [sourcePath]);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  const targetDiagnostics = diagnostics.filter((diagnostic) => (
    diagnostic.code === mutation.diagnosticCode
    && path.resolve(diagnostic.file?.fileName || "") === path.resolve(sourcePath)
    && diagnosticMessage(diagnostic).includes(mutation.diagnosticFragment)
  ));
  if (targetDiagnostics.length !== 1 || diagnostics.length !== 1) {
    throw new Error([
      `official SourceReceipt config did not isolate the expected ${mutation.name} implementation type error`,
      formatDiagnostics(diagnostics) || "<no diagnostics>",
    ].join("\n"));
  }
  return targetDiagnostics[0];
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
  assertOfficialImplementationCheck(parsedConfig, [
    resolvedSourcePath,
    resolvedDocumentSessionSourcePath,
    documentSessionContractPath,
    documentSessionFacadePath,
  ]);
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

  const baselineProgram = programFor({
    parsedConfig,
    sourceOverrides: new Map([
      [resolvedSourcePath, sourceText],
      [resolvedDocumentSessionSourcePath, documentSessionSourceText],
    ]),
  });
  assertProgramInputs(baselineProgram, [
    resolvedSourcePath,
    resolvedDocumentSessionSourcePath,
    documentSessionContractPath,
    documentSessionFacadePath,
  ]);
  const baselineDiagnostics = ts.getPreEmitDiagnostics(baselineProgram);
  if (baselineDiagnostics.length > 0) {
    throw new Error(`official SourceReceipt typecheck must pass before mutation:\n${formatDiagnostics(baselineDiagnostics)}`);
  }

  const receiptDiagnostic = mutationDiagnostic({
    parsedConfig,
    sourcePath: resolvedSourcePath,
    sourceText,
    mutation: receiptMutation,
  });
  const documentSessionDiagnostics = documentSessionMutations.map((mutation) => (
    mutationDiagnostic({
      parsedConfig,
      sourcePath: resolvedDocumentSessionSourcePath,
      sourceText: documentSessionSourceText,
      mutation,
    })
  ));
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

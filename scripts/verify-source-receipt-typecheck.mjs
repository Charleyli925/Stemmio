import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultConfigPath = path.join(productRoot, "tsconfig.source-receipt.json");
const defaultSourcePath = path.join(productRoot, "app/application/source-receipt.js");
const mutationAnchor = "sessionIncarnation: revision(input.sessionIncarnation),";
const mutatedAssignment = "sessionIncarnation: String(input.sessionIncarnation),";

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

function programFor({ parsedConfig, sourcePath, sourceText }) {
  const resolvedSourcePath = path.resolve(sourcePath);
  const host = ts.createCompilerHost(parsedConfig.options, true);
  const defaultReadFile = host.readFile.bind(host);
  host.readFile = (fileName) => (
    path.resolve(fileName) === resolvedSourcePath
      ? sourceText
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

function assertOfficialImplementationCheck(parsedConfig, sourcePath) {
  if (parsedConfig.options.allowJs !== true || parsedConfig.options.checkJs !== true) {
    throw new Error("official SourceReceipt config must enable allowJs and checkJs");
  }
  const resolvedSourcePath = path.resolve(sourcePath);
  if (!parsedConfig.fileNames.some((fileName) => path.resolve(fileName) === resolvedSourcePath)) {
    throw new Error("SourceReceipt implementation is missing from the official compiler inputs");
  }
}

function mutateSource(sourceText) {
  const matchCount = sourceText.split(mutationAnchor).length - 1;
  if (matchCount !== 1) {
    throw new Error(`SourceReceipt mutation anchor must match exactly once; matched ${matchCount}`);
  }
  return sourceText.replace(mutationAnchor, mutatedAssignment);
}

export function verifySourceReceiptTypecheck({
  parsedConfig = loadSourceReceiptTypecheckConfig(),
  sourcePath = defaultSourcePath,
  sourceText = ts.sys.readFile(sourcePath),
} = {}) {
  const resolvedSourcePath = path.resolve(sourcePath);
  assertOfficialImplementationCheck(parsedConfig, resolvedSourcePath);
  if (typeof sourceText !== "string") {
    throw new Error(`cannot read SourceReceipt implementation: ${resolvedSourcePath}`);
  }
  const mutatedSource = mutateSource(sourceText);

  const baselineDiagnostics = ts.getPreEmitDiagnostics(programFor({
    parsedConfig,
    sourcePath: resolvedSourcePath,
    sourceText,
  }));
  if (baselineDiagnostics.length > 0) {
    throw new Error(`official SourceReceipt typecheck must pass before mutation:\n${formatDiagnostics(baselineDiagnostics)}`);
  }

  const mutationDiagnostics = ts.getPreEmitDiagnostics(programFor({
    parsedConfig,
    sourcePath: resolvedSourcePath,
    sourceText: mutatedSource,
  }));
  const targetDiagnostics = mutationDiagnostics.filter((diagnostic) => (
    diagnostic.code === 2322
    && path.resolve(diagnostic.file?.fileName || "") === resolvedSourcePath
    && diagnosticMessage(diagnostic).includes("Type 'string' is not assignable to type 'number'")
    && diagnosticMessage(diagnostic).includes("sessionIncarnation")
  ));
  if (targetDiagnostics.length !== 1 || mutationDiagnostics.length !== 1) {
    throw new Error([
      "official SourceReceipt config did not isolate the expected implementation type error",
      formatDiagnostics(mutationDiagnostics) || "<no diagnostics>",
    ].join("\n"));
  }
  return Object.freeze({
    configPath: parsedConfig.options.configFilePath || defaultConfigPath,
    sourcePath: resolvedSourcePath,
    diagnosticCode: targetDiagnostics[0].code,
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = verifySourceReceiptTypecheck();
  process.stdout.write(
    `SourceReceipt implementation mutation rejected by official config (TS${result.diagnosticCode}).\n`,
  );
}

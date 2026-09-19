import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const defaultConfigPath = path.join(productRoot, "tsconfig.workspace-preferences.json");
const defaultSourcePath = path.join(
  productRoot,
  "app/application/workspace-preferences-session.js",
);
const mutations = Object.freeze([
  Object.freeze({
    name: "committed-persistence",
    anchor: 'return Object.freeze({ status: "committed", intentId, persistence: "confirmed" });',
    replacement: 'return Object.freeze({ status: "committed", intentId, persistence: "pending" });',
    diagnosticFragment: 'Type \'"pending"\' is not assignable to type \'"confirmed"\'',
  }),
  Object.freeze({
    name: "not-started-write",
    anchor: 'return Object.freeze({ status: "superseded", intentId, write: "not-started" });',
    replacement: 'return Object.freeze({ status: "superseded", intentId, write: "started" });',
    diagnosticFragment: 'Type \'"started"\' is not assignable to type \'"not-started"\'',
  }),
  Object.freeze({
    name: "unknown-pending",
    anchor: [
      'phase: "commit",',
      "        pending: true,",
    ].join("\n"),
    replacement: [
      'phase: "commit",',
      "        pending: false,",
    ].join("\n"),
    diagnosticFragment: "Type 'false' is not assignable to type 'true'",
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

export function loadWorkspacePreferencesTypecheckConfig(configPath = defaultConfigPath) {
  const resolvedConfigPath = path.resolve(configPath);
  const loaded = ts.readConfigFile(resolvedConfigPath, ts.sys.readFile);
  if (loaded.error) {
    throw new Error(`cannot read the official WorkspacePreferences config:\n${formatDiagnostics([loaded.error])}`);
  }
  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    path.dirname(resolvedConfigPath),
    undefined,
    resolvedConfigPath,
  );
  if (parsed.errors.length) {
    throw new Error(`cannot parse the official WorkspacePreferences config:\n${formatDiagnostics(parsed.errors)}`);
  }
  return parsed;
}

function programFor({ parsedConfig, sourcePath, sourceText }) {
  const resolvedSourcePath = path.resolve(sourcePath);
  const host = ts.createCompilerHost(parsedConfig.options, true);
  const defaultReadFile = host.readFile.bind(host);
  host.readFile = (fileName) => (
    path.resolve(fileName) === resolvedSourcePath ? sourceText : defaultReadFile(fileName)
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

function mutateExactly(sourceText, mutation) {
  const count = sourceText.split(mutation.anchor).length - 1;
  if (count !== 1) {
    throw new Error(`${mutation.name} mutation anchor must match exactly once; matched ${count}`);
  }
  return sourceText.replace(mutation.anchor, mutation.replacement);
}

export function verifyWorkspacePreferencesTypecheck({
  parsedConfig = loadWorkspacePreferencesTypecheckConfig(),
  sourcePath = defaultSourcePath,
  sourceText = ts.sys.readFile(sourcePath),
} = {}) {
  const resolvedSourcePath = path.resolve(sourcePath);
  if (parsedConfig.options.allowJs !== true || parsedConfig.options.checkJs !== true) {
    throw new Error("official WorkspacePreferences config must enable allowJs and checkJs");
  }
  if (!new Set(parsedConfig.fileNames.map((fileName) => path.resolve(fileName))).has(resolvedSourcePath)) {
    throw new Error(`WorkspacePreferences implementation is missing from the official compiler inputs: ${resolvedSourcePath}`);
  }
  if (typeof sourceText !== "string") {
    throw new Error(`cannot read WorkspacePreferences implementation: ${resolvedSourcePath}`);
  }
  const baseline = ts.getPreEmitDiagnostics(programFor({
    parsedConfig,
    sourcePath: resolvedSourcePath,
    sourceText: ts.sys.readFile(resolvedSourcePath),
  }));
  if (baseline.length) {
    throw new Error(`official WorkspacePreferences typecheck must pass before mutation:\n${formatDiagnostics(baseline)}`);
  }
  const diagnosticCodes = mutations.map((mutation) => {
    const diagnostics = ts.getPreEmitDiagnostics(programFor({
      parsedConfig,
      sourcePath: resolvedSourcePath,
      sourceText: mutateExactly(sourceText, mutation),
    }));
    const expected = diagnostics.filter((diagnostic) => (
      diagnostic.code === 2322
      && path.resolve(diagnostic.file?.fileName || "") === resolvedSourcePath
      && diagnosticMessage(diagnostic).includes(mutation.diagnosticFragment)
    ));
    if (expected.length !== 1 || diagnostics.length !== 1) {
      throw new Error([
        `official WorkspacePreferences config did not isolate the expected ${mutation.name} implementation type error`,
        formatDiagnostics(diagnostics) || "<no diagnostics>",
      ].join("\n"));
    }
    return expected[0].code;
  });
  return Object.freeze({
    configPath: parsedConfig.options.configFilePath || defaultConfigPath,
    sourcePath: resolvedSourcePath,
    diagnosticCodes: Object.freeze(diagnosticCodes),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = verifyWorkspacePreferencesTypecheck();
  process.stdout.write(
    `WorkspacePreferences implementation mutations rejected by official config (${result.diagnosticCodes.map((code) => `TS${code}`).join(", ")}).\n`,
  );
}

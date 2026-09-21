import path from "node:path";

import ts from "typescript";

export function diagnosticMessage(diagnostic) {
  return ts.flattenDiagnosticMessageText(diagnostic.messageText, " ");
}

export function formatDiagnostics(diagnostics) {
  return diagnostics.map((diagnostic) => {
    const file = diagnostic.file?.fileName || "<configuration>";
    if (!diagnostic.file || typeof diagnostic.start !== "number") {
      return `${file}: TS${diagnostic.code} ${diagnosticMessage(diagnostic)}`;
    }
    const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
    return `${file}:${position.line + 1}:${position.character + 1}: TS${diagnostic.code} ${diagnosticMessage(diagnostic)}`;
  }).join("\n");
}

export function loadOfficialTypecheckConfig({ configPath, subject }) {
  const resolvedConfigPath = path.resolve(configPath);
  const loaded = ts.readConfigFile(resolvedConfigPath, ts.sys.readFile);
  if (loaded.error) {
    throw new Error(`cannot read the official ${subject} typecheck config:\n${formatDiagnostics([loaded.error])}`);
  }
  const parsed = ts.parseJsonConfigFileContent(
    loaded.config,
    ts.sys,
    path.dirname(resolvedConfigPath),
    undefined,
    resolvedConfigPath,
  );
  if (parsed.errors.length > 0) {
    throw new Error(`cannot parse the official ${subject} typecheck config:\n${formatDiagnostics(parsed.errors)}`);
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

export function assertOfficialJavaScriptInputs({
  parsedConfig,
  subject,
  requiredInputs,
}) {
  if (parsedConfig.options.allowJs !== true || parsedConfig.options.checkJs !== true) {
    throw new Error(`official ${subject} config must enable allowJs and checkJs`);
  }
  const officialInputs = new Set(parsedConfig.fileNames.map((fileName) => path.resolve(fileName)));
  for (const { path: sourcePath, description } of requiredInputs) {
    const resolvedSourcePath = path.resolve(sourcePath);
    if (!officialInputs.has(resolvedSourcePath)) {
      throw new Error(`${description} is missing from the official compiler inputs: ${resolvedSourcePath}`);
    }
  }
}

export function mutateExactly(sourceText, { name, anchor, replacement }) {
  const matchCount = sourceText.split(anchor).length - 1;
  if (matchCount !== 1) {
    throw new Error(`${name} mutation anchor must match exactly once; matched ${matchCount}`);
  }
  return sourceText.replace(anchor, replacement);
}

export function verifyImplementationMutations({
  parsedConfig,
  subject,
  requiredInputs,
  sourceOverrides,
  mutations,
}) {
  const baselineProgram = programFor({ parsedConfig, sourceOverrides });
  assertProgramInputs(baselineProgram, requiredInputs, subject);
  const baselineDiagnostics = ts.getPreEmitDiagnostics(baselineProgram);
  if (baselineDiagnostics.length > 0) {
    throw new Error(`official ${subject} typecheck must pass before mutation:\n${formatDiagnostics(baselineDiagnostics)}`);
  }

  return mutations.map((mutation) => {
    const mutatedSource = mutateExactly(mutation.sourceText, mutation);
    const overrides = new Map(sourceOverrides);
    overrides.set(mutation.sourcePath, mutatedSource);
    const program = programFor({ parsedConfig, sourceOverrides: overrides });
    assertProgramInputs(program, requiredInputs, subject);
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const targetDiagnostics = diagnostics.filter((diagnostic) => (
      diagnostic.code === mutation.diagnosticCode
      && path.resolve(diagnostic.file?.fileName || "") === path.resolve(mutation.sourcePath)
      && diagnosticMessage(diagnostic).includes(mutation.diagnosticFragment)
    ));
    if (targetDiagnostics.length !== 1 || diagnostics.length !== 1) {
      throw new Error([
        `official ${subject} config did not isolate the expected ${mutation.name} implementation type error`,
        formatDiagnostics(diagnostics) || "<no diagnostics>",
      ].join("\n"));
    }
    return targetDiagnostics[0];
  });
}

function assertProgramInputs(program, requiredInputs, subject) {
  for (const { path: sourcePath } of requiredInputs) {
    const resolvedSourcePath = path.resolve(sourcePath);
    if (!program.getSourceFile(resolvedSourcePath)) {
      throw new Error(`official ${subject} program did not load required input: ${resolvedSourcePath}`);
    }
  }
}

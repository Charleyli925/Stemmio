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
const defaultConfigPath = path.join(productRoot, "tsconfig.workspace-preferences.json");
const defaultSourcePath = path.join(
  productRoot,
  "app/application/workspace-preferences-session.js",
);
const defaultConsumerPath = path.join(
  productRoot,
  "app/application/workspace-preference-mutation-outcome.js",
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
    anchor: 'return Object.freeze({ status: "unknown", intentId, phase, pending: true });',
    replacement: 'return Object.freeze({ status: "unknown", intentId, phase, pending: false });',
    diagnosticFragment: "Type 'false' is not assignable to type 'true'",
  }),
  Object.freeze({
    name: "consumer-unknown-error-code",
    source: "consumer",
    anchor: 'errorCode: "AGENT_PREFERENCES_SAVE_UNKNOWN",',
    replacement: 'errorCode: "AGENT_PREFERENCES_SAVE_FAILED",',
    diagnosticFragment: 'Type \'"AGENT_PREFERENCES_SAVE_FAILED"\' is not assignable to type \'"AGENT_PREFERENCES_SAVE_UNKNOWN"\'',
  }),
]);

export function loadWorkspacePreferencesTypecheckConfig(configPath = defaultConfigPath) {
  return loadOfficialTypecheckConfig({ configPath, subject: "WorkspacePreferences" });
}

export function verifyWorkspacePreferencesTypecheck({
  parsedConfig = loadWorkspacePreferencesTypecheckConfig(),
  sourcePath = defaultSourcePath,
  sourceText = ts.sys.readFile(sourcePath),
  consumerPath = defaultConsumerPath,
  consumerText = ts.sys.readFile(consumerPath),
} = {}) {
  const resolvedSourcePath = path.resolve(sourcePath);
  const resolvedConsumerPath = path.resolve(consumerPath);
  const requiredInputs = [
    { path: resolvedSourcePath, description: "WorkspacePreferences implementation" },
    { path: resolvedConsumerPath, description: "WorkspacePreferences consumer" },
  ];
  assertOfficialJavaScriptInputs({
    parsedConfig,
    subject: "WorkspacePreferences",
    requiredInputs,
  });
  if (typeof sourceText !== "string") {
    throw new Error(`cannot read WorkspacePreferences implementation: ${resolvedSourcePath}`);
  }
  if (typeof consumerText !== "string") {
    throw new Error(`cannot read WorkspacePreferences consumer: ${resolvedConsumerPath}`);
  }
  const sourceOverrides = new Map([
    [resolvedSourcePath, sourceText],
    [resolvedConsumerPath, consumerText],
  ]);
  const mutationCases = mutations.map((mutation) => {
    const mutationSourcePath = mutation.source === "consumer"
      ? resolvedConsumerPath
      : resolvedSourcePath;
    const mutationSourceText = mutation.source === "consumer" ? consumerText : sourceText;
    mutateExactly(mutationSourceText, mutation);
    return {
      ...mutation,
      diagnosticCode: 2322,
      sourcePath: mutationSourcePath,
      sourceText: mutationSourceText,
    };
  });
  const diagnostics = verifyImplementationMutations({
    parsedConfig,
    subject: "WorkspacePreferences",
    requiredInputs,
    sourceOverrides,
    mutations: mutationCases,
  });
  return Object.freeze({
    configPath: parsedConfig.options.configFilePath || defaultConfigPath,
    sourcePath: resolvedSourcePath,
    consumerPath: resolvedConsumerPath,
    diagnosticCodes: Object.freeze(diagnostics.map((diagnostic) => diagnostic.code)),
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = verifyWorkspacePreferencesTypecheck();
  process.stdout.write(
    `WorkspacePreferences implementation mutations rejected by official config (${result.diagnosticCodes.map((code) => `TS${code}`).join(", ")}).\n`,
  );
}

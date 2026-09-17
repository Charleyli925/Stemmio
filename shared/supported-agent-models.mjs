// Stemmio's native Agent is intentionally not a general-purpose model browser.
// `releaseChannel: "stable"` only controls product visibility. Real-protocol
// acceptance lives in `agent-protocol-acceptance.mjs` and is never granted by
// CI fixtures.

export const SUPPORTED_AGENT_MODELS_SCHEMA_VERSION = "1.0.0";
export const SUPPORTED_AGENT_MODELS_REVISION = "2026-09-17.1";

const AUTO = Object.freeze(["auto"]);
const EFFORT = Object.freeze(["auto", "none", "low", "high", "max"]);
const REQUIRED_EFFORT = Object.freeze(["auto", "low", "high", "max"]);
const OPENAI_EFFORT = Object.freeze(["auto", "low", "high"]);

function model(value) {
  return Object.freeze({
    supportsCompleteHtml: true,
    releaseChannel: "beta",
    smokeVersion: null,
    ...value,
    reasoningOptions: Object.freeze([...(value.reasoningOptions || AUTO)]),
  });
}

export const SUPPORTED_AGENT_MODELS = Object.freeze([
  model({
    vendorId: "deepseek",
    modelId: "deepseek-v4-pro",
    displayName: "V4 Pro",
    recommended: true,
    requestAdapter: "deepseek",
    releaseChannel: "stable",
    smokeVersion: "2026-09-06.1",
    reasoningOptions: EFFORT,
    contextWindow: 1_000_000,
    maxOutputTokens: 393_216,
  }),
  model({
    vendorId: "deepseek",
    modelId: "deepseek-v4-flash",
    displayName: "V4 Flash",
    releaseChannel: "stable",
    recommended: false,
    requestAdapter: "deepseek",
    reasoningOptions: EFFORT,
    contextWindow: 1_000_000,
    maxOutputTokens: 393_216,
  }),
  model({
    vendorId: "deepseek",
    modelId: "deepseek-v4-flash-vision-exp",
    displayName: "V4 Flash Vision (实验)",
    recommended: false,
    requestAdapter: "deepseek",
    releaseChannel: "stable",
    reasoningOptions: EFFORT,
    contextWindow: 1_000_000,
    maxOutputTokens: 393_216,
  }),
  model({
    vendorId: "zhipu",
    modelId: "glm-5.3",
    displayName: "GLM-5.3",
    recommended: true,
    requestAdapter: "zhipu",
    reasoningOptions: REQUIRED_EFFORT,
    contextWindow: 1_000_000,
    maxOutputTokens: 131_072,
  }),
  model({
    vendorId: "zhipu",
    modelId: "glm-5.3-flash",
    displayName: "GLM-5.3 Flash",
    recommended: false,
    requestAdapter: "zhipu",
    reasoningOptions: REQUIRED_EFFORT,
    contextWindow: 1_000_000,
    maxOutputTokens: 131_072,
  }),
  model({
    vendorId: "dashscope",
    modelId: "qwen3.8-max",
    displayName: "Qwen 3.8 Max",
    recommended: true,
    requestAdapter: "dashscope",
    reasoningOptions: Object.freeze(["auto", "none", "enabled"]),
    contextWindow: 1_000_000,
    maxOutputTokens: 131_072,
  }),
  model({
    vendorId: "dashscope",
    modelId: "qwen3.8-flash",
    displayName: "Qwen 3.8 Flash",
    recommended: false,
    requestAdapter: "dashscope",
    reasoningOptions: Object.freeze(["auto", "none", "enabled"]),
    contextWindow: 1_000_000,
    maxOutputTokens: 131_072,
  }),
  model({
    vendorId: "openai",
    modelId: "gpt-5.4",
    displayName: "GPT-5.4",
    recommended: true,
    requestAdapter: "openai",
    reasoningOptions: OPENAI_EFFORT,
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
  }),
  model({
    vendorId: "openai",
    modelId: "gpt-5.4-mini",
    displayName: "GPT-5.4 mini",
    recommended: false,
    requestAdapter: "openai",
    reasoningOptions: OPENAI_EFFORT,
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
  }),
]);

export function supportedAgentModelsForVendor(vendorId, { includeBeta = false } = {}) {
  const id = String(vendorId || "");
  return Object.freeze(SUPPORTED_AGENT_MODELS.filter((entry) => (
    entry.vendorId === id && (includeBeta || entry.releaseChannel === "stable")
  )));
}

export function supportedAgentModel(vendorId, modelId, options) {
  return supportedAgentModelsForVendor(vendorId, options)
    .find((entry) => entry.modelId === String(modelId || "")) || null;
}

export function recommendedAgentModel(vendorId, options) {
  const models = supportedAgentModelsForVendor(vendorId, options);
  return models.find((entry) => entry.recommended === true) || models[0] || null;
}

export function betaAgentModelsEnabled(environment = {}) {
  return environment.STEMMIO_ENABLE_BETA_AGENT_MODELS === "1"
    || environment.STEMMIO_E2E === "1";
}

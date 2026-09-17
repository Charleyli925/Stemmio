import {
  betaAgentModelsEnabled,
  recommendedAgentModel,
  supportedAgentModel,
  supportedAgentModelsForVendor,
} from "./supported-agent-models.mjs";

const HTTPS_ORIGIN = /^https:\/\//u;

export const STEMMIO_PROVIDER_ID = "stemmio";
export const STEMMIO_RUNTIME_ID = "http";

const VENDORS = [
  { id: "deepseek", displayName: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", needsBaseUrl: false },
  { id: "zhipu", displayName: "智谱", baseUrl: "https://open.bigmodel.cn/api/paas/v4", needsBaseUrl: false },
  { id: "dashscope", displayName: "阿里通义", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", needsBaseUrl: false },
  { id: "openai", displayName: "OpenAI", baseUrl: "https://api.openai.com/v1", needsBaseUrl: false },
  { id: "custom", displayName: "其他兼容接口", baseUrl: "", needsBaseUrl: true },
];

export const OPENAI_COMPATIBLE_VENDORS = Object.freeze(VENDORS.map(Object.freeze));

export function openaiCompatibleVendor(vendorId) {
  return OPENAI_COMPATIBLE_VENDORS.find((vendor) => vendor.id === vendorId) || null;
}

export function openAiCompatibleVendorDisplayNameForPublicModel(modelId) {
  const providerModelId = String(modelId || "").replace(/^stemmio:/u, "");
  if (!providerModelId) return "";
  const vendor = OPENAI_COMPATIBLE_VENDORS.find((entry) => (
    entry.id !== "custom"
    && supportedAgentModel(entry.id, providerModelId, { includeBeta: true })
  ));
  return String(vendor?.displayName || "");
}

export function normalizeOpenAiCompatibleBaseUrl(value) {
  const text = String(value || "").trim();
  if (!text || !HTTPS_ORIGIN.test(text) || text.length > 200) return "";
  let url;
  try { url = new URL(text); } catch { return ""; }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return "";
  if (!url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".local")) return "";
  return `${url.origin}${url.pathname}`.replace(/\/+$/u, "");
}

export function resolveOpenAiCompatibleVendor(vendorId, baseUrl) {
  const vendor = openaiCompatibleVendor(String(vendorId || "").trim());
  if (!vendor) return null;
  if (!vendor.needsBaseUrl) return vendor;
  const resolved = normalizeOpenAiCompatibleBaseUrl(baseUrl);
  return resolved ? Object.freeze({ ...vendor, baseUrl: resolved }) : null;
}

const LOOPBACK_HTTP = /^https?:\/\/127\.0\.0\.1(?::\d+)?(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%-]*)?$/u;

export function httpAgentTestOverrideEnabled(environment = {}) {
  return environment.STEMMIO_E2E === "1"
    && environment.STEMMIO_HTTP_AGENT_ALLOW_TEST_BASE_URL === "1";
}

export function testOpenAiCompatibleBaseUrl(environment = {}) {
  if (!httpAgentTestOverrideEnabled(environment)) return "";
  const text = String(environment.STEMMIO_HTTP_AGENT_BASE_URL || "").trim();
  if (!text || text.length > 200 || !LOOPBACK_HTTP.test(text)) return "";
  let url;
  try { url = new URL(text); } catch { return ""; }
  if (!["http:", "https:"].includes(url.protocol) || url.hostname !== "127.0.0.1"
    || url.username || url.password || url.search || url.hash) return "";
  return `${url.origin}${url.pathname}`.replace(/\/+$/u, "");
}

export function httpAgentLaunchBaseUrl(environment, vendorBaseUrl) {
  return httpAgentTestOverrideEnabled(environment)
    ? testOpenAiCompatibleBaseUrl(environment)
    : String(vendorBaseUrl || "");
}

export const OPENAI_COMPATIBLE_REASONING_CHOICES = Object.freeze([
  Object.freeze({ id: "auto", label: "自动" }),
  Object.freeze({ id: "none", label: "关闭" }),
  Object.freeze({ id: "low", label: "低" }),
  Object.freeze({ id: "high", label: "高" }),
  Object.freeze({ id: "max", label: "最深" }),
  Object.freeze({ id: "enabled", label: "开启" }),
]);
export const DEFAULT_OPENAI_COMPATIBLE_REASONING = "auto";

const CHOICE_BY_ID = new Map(OPENAI_COMPATIBLE_REASONING_CHOICES.map((choice) => [choice.id, choice]));

export function openAiCompatibleModelCapability(vendorId, modelId, { includeBeta = true } = {}) {
  if (vendorId === "custom") {
    return Object.freeze({ reasoningChoices: Object.freeze([CHOICE_BY_ID.get("auto")]), model: null });
  }
  const entry = supportedAgentModel(vendorId, modelId, { includeBeta });
  const ids = entry?.reasoningOptions || ["auto"];
  return Object.freeze({
    reasoningChoices: Object.freeze(ids.map((id) => CHOICE_BY_ID.get(id)).filter(Boolean)),
    model: entry,
  });
}

export function normalizeOpenAiCompatibleReasoning(value) {
  const id = String(value || "").trim();
  return CHOICE_BY_ID.has(id) ? id : "";
}

export function openaiCompatibleChatThinkingFields(vendorId, modelId, reasoning) {
  const requested = normalizeOpenAiCompatibleReasoning(reasoning);
  const supported = openAiCompatibleModelCapability(vendorId, modelId).reasoningChoices
    .some((choice) => choice.id === requested);
  if (!requested || requested === "auto" || !supported || vendorId === "custom") return Object.freeze({});
  if (vendorId === "openai") return Object.freeze({ reasoning_effort: requested });
  if (vendorId === "dashscope") return Object.freeze({ enable_thinking: requested !== "none" });
  if (requested === "none") return Object.freeze({ thinking: Object.freeze({ type: "disabled" }) });
  return Object.freeze({
    thinking: Object.freeze({ type: "enabled" }),
    ...(requested !== "enabled" ? { reasoning_effort: requested } : {}),
  });
}

export function publicOpenAiCompatibleReasoningChoices(vendorId, modelId) {
  return openAiCompatibleModelCapability(vendorId, modelId).reasoningChoices;
}

export function publicModelsForVendor(vendorId, environment = {}) {
  if (vendorId === "custom") return Object.freeze([]);
  const includeBeta = betaAgentModelsEnabled(environment);
  return Object.freeze(supportedAgentModelsForVendor(vendorId, { includeBeta }).map((entry) => Object.freeze({
    id: `${STEMMIO_PROVIDER_ID}:${entry.modelId}`,
    providerModelId: entry.modelId,
    displayName: entry.displayName,
    isDefault: entry.recommended === true,
    releaseChannel: entry.releaseChannel,
    contextWindow: entry.contextWindow,
    maxOutputTokens: entry.maxOutputTokens,
    supportsCompleteHtml: entry.supportsCompleteHtml,
    reasoningChoices: entry.reasoningOptions.map((id) => CHOICE_BY_ID.get(id)).filter(Boolean),
  })));
}

export function publicOpenAiCompatibleVendors({
  includeBeta = globalThis.stemmioRuntime?.betaAgentModelsEnabled === true,
} = {}) {
  return Object.freeze(OPENAI_COMPATIBLE_VENDORS.filter((vendor) => (
    vendor.id === "custom"
    || supportedAgentModelsForVendor(vendor.id, { includeBeta }).length > 0
  )).map((vendor) => Object.freeze({
    id: vendor.id,
    label: vendor.displayName,
    needsBaseUrl: vendor.needsBaseUrl === true,
    compatibilityMode: vendor.id === "custom",
  })));
}

export { betaAgentModelsEnabled, recommendedAgentModel, supportedAgentModel };

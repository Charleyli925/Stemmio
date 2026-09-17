import { openaiCompatibleChatThinkingFields } from "../../../shared/openai-compatible-vendors.mjs";

const CONTEXT_CODES = new Set(["context_length_exceeded", "input_too_long", "prompt_too_long"]);
const MODEL_CODES = new Set(["model_not_found", "model_not_available", "model_unavailable", "unsupported_model"]);
const ACCESS_CODES = new Set(["model_access_denied", "permission_denied", "insufficient_permissions"]);
const AUTH_CODES = new Set(["authentication_error", "invalid_api_key", "invalid_token", "unauthorized", "unauthenticated"]);
const BALANCE_CODES = new Set(["insufficient_balance", "insufficient_quota_balance", "billing_not_active"]);
const PLAN_CODES = new Set(["insufficient_quota", "quota_exceeded", "plan_limit_exceeded"]);
const RATE_CODES = new Set(["rate_limit_exceeded", "requests_rate_limit_exceeded", "tokens_rate_limit_exceeded"]);
const REGION_CODES = new Set(["region_not_supported", "endpoint_region_mismatch", "invalid_region"]);
const OVERLOAD_CODES = new Set(["overloaded", "server_overloaded", "engine_overloaded"]);

function cleanCode(value) { return String(value || "").trim().toLowerCase().slice(0, 120); }
function payloadCode(payload) {
  return cleanCode(payload?.error?.code || payload?.error?.type || payload?.code || payload?.type);
}

function normalizeError({ status, payload, transportCode } = {}) {
  const numericStatus = Number(status || 0);
  const code = payloadCode(payload);
  const transport = cleanCode(transportCode);
  if (["abort_err", "aborterror", "etimedout", "timeout_err", "timeouterror"].includes(transport)) {
    return "AGENT_TURN_TIMEOUT";
  }
  if (numericStatus === 401 || AUTH_CODES.has(code)) return "AGENT_AUTH_REQUIRED";
  if (numericStatus === 403 || ACCESS_CODES.has(code)) return "AGENT_MODEL_ACCESS_DENIED";
  if (BALANCE_CODES.has(code)) return "AGENT_BALANCE_INSUFFICIENT";
  if (PLAN_CODES.has(code)) return "AGENT_PLAN_LIMIT";
  if (REGION_CODES.has(code)) return "AGENT_ENDPOINT_REGION_MISMATCH";
  if (CONTEXT_CODES.has(code) || numericStatus === 413) return "AGENT_PROMPT_TOO_LARGE";
  if (MODEL_CODES.has(code)) return "AGENT_SELECTION_UNSUPPORTED";
  if (OVERLOAD_CODES.has(code) || [502, 503].includes(numericStatus)) return "AGENT_PROVIDER_OVERLOADED";
  if (numericStatus === 429 || RATE_CODES.has(code)) return "AGENT_RATE_LIMITED";
  if ([408, 504].includes(numericStatus)) return "AGENT_TURN_TIMEOUT";
  return "AGENT_PROVIDER_UNAVAILABLE";
}

function normalizeResponse(payload) {
  const choice = payload?.choices?.[0];
  return Object.freeze({
    content: choice?.message?.content,
    finishReason: choice?.finish_reason || null,
  });
}

function localCapabilityModelId(modelCapability) {
  const value = String(modelCapability?.providerModelId || modelCapability?.modelId
    || modelCapability?.id || "");
  return value.replace(/^stemmio:/u, "");
}

function outputParameter(vendorId, modelId, modelCapability) {
  if (vendorId === "custom") return null;
  const capabilityModelId = localCapabilityModelId(modelCapability);
  if (capabilityModelId !== String(modelId || "")
    || !Number.isSafeInteger(modelCapability.maxOutputTokens)
    || modelCapability.maxOutputTokens <= 0) {
    throw new TypeError("Known HTTP Agent models require a matching maximum-output capability.");
  }
  return Object.freeze({
    name: vendorId === "openai" ? "max_completion_tokens" : "max_tokens",
    value: modelCapability.maxOutputTokens,
  });
}

function buildChatRequest(vendorId, { modelId, messages, reasoning, modelCapability } = {}) {
  const output = outputParameter(vendorId, modelId, modelCapability);
  const outputField = output ? { [output.name]: output.value } : {};
  return Object.freeze({
    endpoint: "/chat/completions",
    body: Object.freeze({
      model: String(modelId || ""),
      messages,
      ...outputField,
      ...openaiCompatibleChatThinkingFields(vendorId, modelId, reasoning),
    }),
  });
}

function adapter(vendorId) {
  const id = String(vendorId || "custom");
  return Object.freeze({
    vendorId: id,
    endpoint: "/chat/completions",
    reasoningFields(modelId, reasoning) {
      return openaiCompatibleChatThinkingFields(id, modelId, reasoning);
    },
    outputParameter(modelId, modelCapability) {
      return outputParameter(id, modelId, modelCapability);
    },
    buildChatRequest(input) { return buildChatRequest(id, input); },
    normalizeResponse,
    normalizeError,
  });
}

const ADAPTERS = Object.freeze(new Map(
  ["deepseek", "zhipu", "dashscope", "openai", "custom"].map((id) => [id, adapter(id)]),
));

export function openAiCompatibleVendorAdapter(vendorId) {
  return ADAPTERS.get(String(vendorId || "")) || ADAPTERS.get("custom");
}

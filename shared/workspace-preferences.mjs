import {
  normalizeAgentConfigurations,
  validAgentConfigurations,
  normalizeDocumentAgentSelections,
  validDocumentAgentSelections,
} from "./agent-configuration-preferences.mjs";

/** @typedef {"system" | "reduced"} WorkspacePreferenceMotion */
/** @typedef {"stemmio" | "qoder" | "codex"} WorkspacePreferenceAgentId */
/** @typedef {Readonly<{
 *   rememberPanelWidths: boolean;
 *   sidebarWidth: number;
 *   inspectorWidth: number;
 *   motion: WorkspacePreferenceMotion;
 *   restoreTabsOnLaunch: boolean;
 *   reviewChangeContextVisibility: number;
 *   reviewCommentContextVisibility: number;
 *   defaultAgentProviderId: WorkspacePreferenceAgentId;
 *   agentConfigurations: Readonly<Record<string, Readonly<{ modelId: string | null; reasoning: string | null }>>>;
 *   documentAgentSelections: Readonly<Record<string, WorkspacePreferenceAgentId>>;
 *   disabledAgentProviderIds: readonly WorkspacePreferenceAgentId[];
 * }>} WorkspacePreferences */

export const WORKSPACE_PREFERENCE_DEFAULTS = Object.freeze({
  rememberPanelWidths: true,
  sidebarWidth: 264,
  inspectorWidth: 376,
  motion: "system",
  restoreTabsOnLaunch: true,
  reviewChangeContextVisibility: 25,
  reviewCommentContextVisibility: 15,
  defaultAgentProviderId: "qoder",
  agentConfigurations: Object.freeze({}),
  documentAgentSelections: Object.freeze({}),
  disabledAgentProviderIds: Object.freeze([]),
});

export const WORKSPACE_PREFERENCE_LIMITS = Object.freeze({
  sidebarWidth: Object.freeze({ min: 200, max: 420 }),
  inspectorWidth: Object.freeze({ min: 280, max: 520 }),
  reviewChangeContextVisibility: Object.freeze({ min: 0, max: 100 }),
  reviewCommentContextVisibility: Object.freeze({ min: 0, max: 100 }),
});

export const WORKSPACE_PREFERENCE_SCHEMA_VERSION = 2;

const MOTION_VALUES = new Set(["system", "reduced"]);
const AGENT_PROVIDER_IDS = new Set(["stemmio", "qoder", "codex"]);
const WORKSPACE_KEYS = new Set(Object.keys(WORKSPACE_PREFERENCE_DEFAULTS));

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @returns {readonly WorkspacePreferenceAgentId[]} */
function normalizedDisabledAgentProviderIds(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  /** @type {WorkspacePreferenceAgentId[]} */
  const ids = [];
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || !AGENT_PROVIDER_IDS.has(item) || seen.has(item)) continue;
    seen.add(item);
    ids.push(/** @type {WorkspacePreferenceAgentId} */ (item));
  }
  return Object.freeze(ids);
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {Readonly<{ min: number; max: number }>} limits
 * @returns {number}
 */
function normalizedWidth(value, fallback, { min, max }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(max, Math.max(min, value)) * 10) / 10;
}

/** @param {unknown} value @returns {WorkspacePreferences} */
export function normalizeWorkspacePreferences(value) {
  const source = isRecord(value) ? value : {};
  return Object.freeze({
    rememberPanelWidths: typeof source.rememberPanelWidths === "boolean"
      ? source.rememberPanelWidths
      : WORKSPACE_PREFERENCE_DEFAULTS.rememberPanelWidths,
    sidebarWidth: normalizedWidth(
      source.sidebarWidth,
      WORKSPACE_PREFERENCE_DEFAULTS.sidebarWidth,
      WORKSPACE_PREFERENCE_LIMITS.sidebarWidth,
    ),
    inspectorWidth: normalizedWidth(
      source.inspectorWidth,
      WORKSPACE_PREFERENCE_DEFAULTS.inspectorWidth,
      WORKSPACE_PREFERENCE_LIMITS.inspectorWidth,
    ),
    motion: /** @type {WorkspacePreferenceMotion} */ (
      typeof source.motion === "string" && MOTION_VALUES.has(source.motion)
        ? source.motion
        : WORKSPACE_PREFERENCE_DEFAULTS.motion
    ),
    restoreTabsOnLaunch: typeof source.restoreTabsOnLaunch === "boolean"
      ? source.restoreTabsOnLaunch
      : WORKSPACE_PREFERENCE_DEFAULTS.restoreTabsOnLaunch,
    reviewChangeContextVisibility: normalizedWidth(
      source.reviewChangeContextVisibility,
      WORKSPACE_PREFERENCE_DEFAULTS.reviewChangeContextVisibility,
      WORKSPACE_PREFERENCE_LIMITS.reviewChangeContextVisibility,
    ),
    reviewCommentContextVisibility: normalizedWidth(
      source.reviewCommentContextVisibility,
      WORKSPACE_PREFERENCE_DEFAULTS.reviewCommentContextVisibility,
      WORKSPACE_PREFERENCE_LIMITS.reviewCommentContextVisibility,
    ),
    defaultAgentProviderId: /** @type {WorkspacePreferenceAgentId} */ (
      typeof source.defaultAgentProviderId === "string"
        && AGENT_PROVIDER_IDS.has(source.defaultAgentProviderId)
        ? source.defaultAgentProviderId
        : WORKSPACE_PREFERENCE_DEFAULTS.defaultAgentProviderId
    ),
    disabledAgentProviderIds: normalizedDisabledAgentProviderIds(source.disabledAgentProviderIds),
    agentConfigurations: normalizeAgentConfigurations(source.agentConfigurations),
    documentAgentSelections: normalizeDocumentAgentSelections(source.documentAgentSelections),
  });
}

/** @param {unknown} value @returns {Readonly<Partial<WorkspacePreferences>>} */
export function normalizeWorkspacePatch(value) {
  if (!isRecord(value) || !Object.keys(value).length) {
    throw new TypeError("工作台偏好不能为空。");
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !WORKSPACE_KEYS.has(key))) {
    throw new TypeError("工作台偏好包含未知字段。");
  }
  /** @type {Record<string, unknown>} */
  const normalized = {};
  for (const key of keys) {
    const next = value[key];
    if (key === "documentAgentSelections") {
      if (!validDocumentAgentSelections(next)) throw new TypeError("文档服务选择无效或已达到数量上限。");
      normalized[key] = normalizeDocumentAgentSelections(next);
      continue;
    }
    if (key === "agentConfigurations") {
      if (!validAgentConfigurations(next)) throw new TypeError("服务配置无效。");
      normalized[key] = normalizeAgentConfigurations(next);
      continue;
    }
    if (key === "rememberPanelWidths" || key === "restoreTabsOnLaunch") {
      if (typeof next !== "boolean") throw new TypeError(`${key} 必须是布尔值。`);
      normalized[key] = next;
      continue;
    }
    if (key === "motion") {
      if (typeof next !== "string" || !MOTION_VALUES.has(next)) {
        throw new TypeError("动态效果选项无效。");
      }
      normalized[key] = next;
      continue;
    }
    if (key === "defaultAgentProviderId") {
      if (typeof next !== "string" || !AGENT_PROVIDER_IDS.has(next)) {
        throw new TypeError("默认 Agent 无效。");
      }
      normalized[key] = next;
      continue;
    }
    if (key === "disabledAgentProviderIds") {
      if (!Array.isArray(next) || next.some((id) => (
        typeof id !== "string" || !AGENT_PROVIDER_IDS.has(id)
      ))) {
        throw new TypeError("停用的 AI 服务无效。");
      }
      normalized[key] = normalizedDisabledAgentProviderIds(next);
      continue;
    }
    const limits = /** @type {Record<string, Readonly<{ min: number; max: number }>>} */ (
      WORKSPACE_PREFERENCE_LIMITS
    )[key];
    if (
      typeof next !== "number"
      || !Number.isFinite(next)
      || next < limits.min
      || next > limits.max
    ) throw new TypeError(`${key} 超出允许范围。`);
    normalized[key] = Math.round(next * 10) / 10;
  }
  return Object.freeze(normalized);
}

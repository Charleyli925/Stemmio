import { normalizeAgentConfigurations, validAgentConfigurations, normalizeDocumentAgentSelections, validDocumentAgentSelections } from "../../shared/agent-configuration-preferences.mjs";

export const DEFAULT_WORKSPACE_PREFERENCES = Object.freeze({
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

const WORKSPACE_KEYS = new Set(Object.keys(DEFAULT_WORKSPACE_PREFERENCES));
const AGENT_PROVIDER_IDS = new Set(["stemmio", "qoder", "codex"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedDisabledAgentProviderIds(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  const ids = [];
  const seen = new Set();
  for (const item of value) {
    if (!AGENT_PROVIDER_IDS.has(item) || seen.has(item)) continue;
    seen.add(item);
    ids.push(item);
  }
  return Object.freeze(ids);
}

function normalizedWidth(value, fallback, { min, max }) {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.round(Math.min(max, Math.max(min, value)) * 10) / 10;
}

export function normalizeWorkspacePreferences(value) {
  const source = isRecord(value) ? value : {};
  return Object.freeze({
    rememberPanelWidths: typeof source.rememberPanelWidths === "boolean"
      ? source.rememberPanelWidths
      : DEFAULT_WORKSPACE_PREFERENCES.rememberPanelWidths,
    sidebarWidth: normalizedWidth(
      source.sidebarWidth,
      DEFAULT_WORKSPACE_PREFERENCES.sidebarWidth,
      WORKSPACE_PREFERENCE_LIMITS.sidebarWidth,
    ),
    inspectorWidth: normalizedWidth(
      source.inspectorWidth,
      DEFAULT_WORKSPACE_PREFERENCES.inspectorWidth,
      WORKSPACE_PREFERENCE_LIMITS.inspectorWidth,
    ),
    motion: source.motion === "reduced" ? "reduced" : "system",
    restoreTabsOnLaunch: typeof source.restoreTabsOnLaunch === "boolean"
      ? source.restoreTabsOnLaunch
      : DEFAULT_WORKSPACE_PREFERENCES.restoreTabsOnLaunch,
    reviewChangeContextVisibility: normalizedWidth(
      source.reviewChangeContextVisibility,
      DEFAULT_WORKSPACE_PREFERENCES.reviewChangeContextVisibility,
      WORKSPACE_PREFERENCE_LIMITS.reviewChangeContextVisibility,
    ),
    reviewCommentContextVisibility: normalizedWidth(
      source.reviewCommentContextVisibility,
      DEFAULT_WORKSPACE_PREFERENCES.reviewCommentContextVisibility,
      WORKSPACE_PREFERENCE_LIMITS.reviewCommentContextVisibility,
    ),
    defaultAgentProviderId: AGENT_PROVIDER_IDS.has(source.defaultAgentProviderId)
      ? source.defaultAgentProviderId
      : DEFAULT_WORKSPACE_PREFERENCES.defaultAgentProviderId,
    disabledAgentProviderIds: normalizedDisabledAgentProviderIds(source.disabledAgentProviderIds),
    agentConfigurations: normalizeAgentConfigurations(source.agentConfigurations),
    documentAgentSelections: normalizeDocumentAgentSelections(source.documentAgentSelections),
  });
}

export function normalizeWorkspacePatch(value) {
  if (!isRecord(value) || !Object.keys(value).length) {
    throw new TypeError("工作台偏好不能为空。");
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !WORKSPACE_KEYS.has(key))) {
    throw new TypeError("工作台偏好包含未知字段。");
  }
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
      if (next !== "system" && next !== "reduced") {
        throw new TypeError("动态效果选项无效。");
      }
      normalized[key] = next;
      continue;
    }
    if (key === "defaultAgentProviderId") {
      if (!AGENT_PROVIDER_IDS.has(next)) {
        throw new TypeError("默认 Agent 无效。");
      }
      normalized[key] = next;
      continue;
    }
    if (key === "disabledAgentProviderIds") {
      if (!Array.isArray(next) || next.some((id) => !AGENT_PROVIDER_IDS.has(id))) {
        throw new TypeError("停用的 AI 服务无效。");
      }
      normalized[key] = normalizedDisabledAgentProviderIds(next);
      continue;
    }
    const limits = WORKSPACE_PREFERENCE_LIMITS[key];
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

function freezeSnapshot({
  loaded = false,
  saving = false,
  error = null,
  workspace = DEFAULT_WORKSPACE_PREFERENCES,
} = {}) {
  return Object.freeze({
    loaded: Boolean(loaded),
    saving: Boolean(saving),
    error: error ? String(error) : null,
    workspace: normalizeWorkspacePreferences(workspace),
  });
}

function deadlinePromise(deadlineAt, clock) {
  const remaining = Math.max(0, Number(deadlineAt) - Number(clock()));
  if (!remaining) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), remaining);
    timer.unref?.();
  });
}

export class WorkspacePreferencesSession {
  #port;
  #clock;
  #listeners = new Set();
  #snapshot = freezeSnapshot();
  #loadPromise = null;
  #writePromise = null;
  #agentMutationTail = Promise.resolve();
  #pendingPatch = null;
  #disposed = false;

  constructor({ port = null, clock = Date } = {}) {
    if (
      port !== null
      && (
        !isRecord(port)
        || typeof port.get !== "function"
        || typeof port.record !== "function"
      )
    ) throw new TypeError("WorkspacePreferencesSession requires a get/record port.");
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("WorkspacePreferencesSession requires a ClockPort.");
    }
    this.#port = port;
    this.#clock = clock;
  }

  get snapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("Workspace preferences listener is required.");
    }
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  async load() {
    if (this.#disposed) return this.#snapshot;
    if (!this.#port) {
      this.#publish({ ...this.#snapshot, loaded: true });
      return this.#snapshot;
    }
    if (this.#loadPromise) return this.#loadPromise;
    this.#loadPromise = Promise.resolve()
      .then(() => this.#port.get())
      .then((preferences) => {
        if (this.#disposed) return this.#snapshot;
        const loaded = normalizeWorkspacePreferences(preferences?.workspace);
        const workspace = this.#pendingPatch
          ? { ...loaded, ...this.#pendingPatch }
          : loaded;
        this.#publish({
          ...this.#snapshot,
          loaded: true,
          workspace,
        });
        return this.#snapshot;
      })
      .catch(() => {
        if (this.#disposed) return this.#snapshot;
        this.#publish({ ...this.#snapshot, loaded: true });
        return this.#snapshot;
      })
      .finally(() => {
        this.#loadPromise = null;
      });
    return this.#loadPromise;
  }

  update(patch) {
    if (this.#disposed) return Promise.resolve(false);
    const normalized = normalizeWorkspacePatch(patch);
    this.#pendingPatch = {
      ...(this.#pendingPatch || {}),
      ...normalized,
    };
    this.#publish({
      ...this.#snapshot,
      workspace: { ...this.#snapshot.workspace, ...normalized },
      saving: Boolean(this.#port),
      error: null,
    });
    if (!this.#port) {
      this.#pendingPatch = null;
      return Promise.resolve(true);
    }
    // Hydration and the first user change can happen in the same turn. Let the
    // read establish the persisted baseline before the first read-modify-write
    // so a stale get result cannot overwrite an optimistic Settings change.
    if (!this.#snapshot.loaded) {
      if (!this.#writePromise) {
        this.#writePromise = this.load().then(() => this.#pump());
      }
      return this.#writePromise;
    }
    if (!this.#writePromise) this.#writePromise = this.#pump();
    return this.#writePromise;
  }

  commitDefaultAgent({ providerId, isCurrent }) {
    if (typeof isCurrent !== "function") {
      throw new TypeError("Default Agent commit requires a current-intent guard.");
    }
    return this.#enqueueAgentMutation(async () => {
      await this.load();
      if (!isCurrent()) return Object.freeze({ status: "superseded" });
      const previousProviderId = this.#snapshot.workspace.defaultAgentProviderId;
      const saved = await this.update({ defaultAgentProviderId: providerId });
      if (!saved) return Object.freeze({ status: "failed" });
      if (isCurrent()) return Object.freeze({ status: "committed" });
      const restored = await this.update({ defaultAgentProviderId: previousProviderId });
      return Object.freeze({ status: restored ? "superseded" : "failed" });
    });
  }

  setProviderDisabled({ providerId, disabled }) {
    return this.#enqueueAgentMutation(async () => {
      await this.load();
      const current = this.#snapshot.workspace.disabledAgentProviderIds;
      const next = disabled
        ? Array.from(new Set([...current, providerId]))
        : current.filter((id) => id !== providerId);
      return this.update({ disabledAgentProviderIds: next });
    });
  }

  retry() {
    if (this.#disposed || !this.#pendingPatch || !this.#port) return false;
    this.#publish({ ...this.#snapshot, saving: true, error: null });
    if (!this.#writePromise) this.#writePromise = this.#pump();
    return true;
  }

  async flush({ deadlineAt } = {}) {
    const pending = this.#writePromise;
    if (!pending) return !this.#pendingPatch;
    if (!Number.isFinite(Number(deadlineAt))) return pending;
    const result = await Promise.race([
      pending,
      deadlinePromise(deadlineAt, () => this.#clock.now()),
    ]);
    return result === true;
  }

  dispose() {
    this.#disposed = true;
    this.#listeners.clear();
    this.#pendingPatch = null;
  }

  async #pump() {
    let successful = true;
    let retried = false;
    try {
      while (!this.#disposed && this.#pendingPatch) {
        const patch = this.#pendingPatch;
        this.#pendingPatch = null;
        try {
          const preferences = await this.#port.record({ workspace: patch });
          if (this.#disposed) break;
          const workspace = normalizeWorkspacePreferences(preferences?.workspace);
          this.#publish({
            ...this.#snapshot,
            workspace: this.#pendingPatch
              ? { ...workspace, ...this.#pendingPatch }
              : workspace,
            saving: Boolean(this.#pendingPatch),
            error: null,
          });
        } catch (cause) {
          this.#pendingPatch = { ...patch, ...(this.#pendingPatch || {}) };
          // Preferences are reversible. Re-read the disk receipt and retry once;
          // keep pending changes for the next update if storage remains unavailable.
          if (!retried && !this.#disposed) {
            retried = true;
            await this.#port.get().catch(() => {});
            continue;
          }
          successful = false;
          this.#publish({
            ...this.#snapshot,
            saving: false,
            error: String(cause?.message || cause || "工作台偏好暂时无法保存。"),
          });
          break;
        }
      }
    } finally {
      this.#writePromise = null;
      if (this.#pendingPatch && successful) {
        this.#publish({ ...this.#snapshot, saving: false });
      } else if (!this.#pendingPatch && this.#snapshot.saving) {
        this.#publish({ ...this.#snapshot, saving: false });
      }
    }
    return successful && !this.#pendingPatch;
  }

  #enqueueAgentMutation(task) {
    const mutation = this.#agentMutationTail.then(task, task);
    this.#agentMutationTail = mutation.catch(() => {});
    return mutation;
  }

  #publish(next) {
    this.#snapshot = freezeSnapshot(next);
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // Preference presentation cannot interrupt an edit or close flow.
      }
    }
  }
}

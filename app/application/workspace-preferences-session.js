import { normalizeAgentConfigurations, validAgentConfigurations, normalizeDocumentAgentSelections, validDocumentAgentSelections } from "../../shared/agent-configuration-preferences.mjs";

/** @typedef {import("./workspace-preferences-session.d.ts").WorkspacePreferenceAgentId} WorkspacePreferenceAgentId */
/** @typedef {import("./workspace-preferences-session.d.ts").WorkspacePreferenceMutationResult} WorkspacePreferenceMutationResult */
/** @typedef {import("./workspace-preferences-session.d.ts").WorkspacePreferences} WorkspacePreferences */
/** @typedef {import("./workspace-preferences-session.d.ts").WorkspacePreferencesPort} WorkspacePreferencesPort */
/** @typedef {import("./workspace-preferences-session.d.ts").WorkspacePreferencesSnapshot} WorkspacePreferencesSnapshot */
/** @typedef {Readonly<Partial<WorkspacePreferences>>} WorkspacePreferencesPatch */
/** @typedef {Readonly<{ now(): number }>} ClockPort */
/** @typedef {Readonly<{ ok: true; workspace: WorkspacePreferences }> | Readonly<{ ok: false }>} WorkspaceAuthorityRead */

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

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @returns {readonly WorkspacePreferenceAgentId[]} */
function normalizedDisabledAgentProviderIds(value) {
  if (!Array.isArray(value)) return Object.freeze([]);
  /** @type {WorkspacePreferenceAgentId[]} */
  const ids = [];
  /** @type {Set<unknown>} */
  const seen = new Set();
  for (const item of value) {
    if (!AGENT_PROVIDER_IDS.has(item) || seen.has(item)) continue;
    seen.add(item);
    ids.push(/** @type {WorkspacePreferenceAgentId} */ (item));
  }
  return Object.freeze(ids);
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {Readonly<{ min: number; max: number }>} limits
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
    defaultAgentProviderId: typeof source.defaultAgentProviderId === "string"
      && AGENT_PROVIDER_IDS.has(source.defaultAgentProviderId)
      ? /** @type {WorkspacePreferenceAgentId} */ (source.defaultAgentProviderId)
      : DEFAULT_WORKSPACE_PREFERENCES.defaultAgentProviderId,
    disabledAgentProviderIds: normalizedDisabledAgentProviderIds(source.disabledAgentProviderIds),
    agentConfigurations: normalizeAgentConfigurations(source.agentConfigurations),
    documentAgentSelections: normalizeDocumentAgentSelections(source.documentAgentSelections),
  });
}

/** @param {unknown} value @returns {WorkspacePreferencesPatch} */
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
      if (next !== "system" && next !== "reduced") {
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
      if (!Array.isArray(next) || next.some((id) => !AGENT_PROVIDER_IDS.has(id))) {
        throw new TypeError("停用的 AI 服务无效。");
      }
      normalized[key] = normalizedDisabledAgentProviderIds(next);
      continue;
    }
    const limits = WORKSPACE_PREFERENCE_LIMITS[
      /** @type {"sidebarWidth" | "inspectorWidth" | "reviewChangeContextVisibility" | "reviewCommentContextVisibility"} */ (key)
    ];
    if (
      typeof next !== "number"
      || !Number.isFinite(next)
      || next < limits.min
      || next > limits.max
    ) throw new TypeError(`${key} 超出允许范围。`);
    normalized[key] = Math.round(next * 10) / 10;
  }
  return /** @type {WorkspacePreferencesPatch} */ (Object.freeze(normalized));
}

/**
 * @param {Partial<WorkspacePreferencesSnapshot>} [input]
 * @returns {WorkspacePreferencesSnapshot}
 */
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

/** @param {number} deadlineAt @param {() => number} clock @returns {Promise<false>} */
function deadlinePromise(deadlineAt, clock) {
  const remaining = Math.max(0, Number(deadlineAt) - Number(clock()));
  if (!remaining) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), remaining);
    timer.unref?.();
  });
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
function samePreferenceValue(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((item, index) => samePreferenceValue(item, right[index]));
  }
  if (!isRecord(left) || !isRecord(right)) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.hasOwn(right, key)
      && samePreferenceValue(left[key], right[key]));
}

/** @param {WorkspacePreferencesPatch} patch @param {WorkspacePreferences} workspace */
function workspaceMatchesPatch(patch, workspace) {
  const record = /** @type {Record<string, unknown>} */ (workspace);
  return Object.entries(patch).every(([key, value]) => (
    Object.hasOwn(record, key) && samePreferenceValue(record[key], value)
  ));
}

export class WorkspacePreferencesSession {
  /** @type {WorkspacePreferencesPort | null} */
  #port;
  /** @type {ClockPort} */
  #clock;
  /** @type {Set<(snapshot: WorkspacePreferencesSnapshot) => void>} */
  #listeners = new Set();
  /** @type {WorkspacePreferencesSnapshot} */
  #snapshot = freezeSnapshot();
  /** @type {Promise<WorkspacePreferencesSnapshot> | null} */
  #loadPromise = null;
  /** @type {Promise<boolean> | null} */
  #writePromise = null;
  /** @type {Promise<unknown>} */
  #agentMutationTail = Promise.resolve();
  /** @type {WorkspacePreferencesPatch | null} */
  #pendingPatch = null;
  #disposed = false;

  /** @param {{ port?: WorkspacePreferencesPort | null; clock?: ClockPort }} [options] */
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

  /** @param {(snapshot: WorkspacePreferencesSnapshot) => void} listener */
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
    const port = this.#port;
    this.#loadPromise = Promise.resolve()
      .then(() => port.get())
      .then((preferences) => {
        if (this.#disposed) return this.#snapshot;
        const loaded = normalizeWorkspacePreferences(
          isRecord(preferences) ? preferences.workspace : undefined,
        );
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

  /** @param {WorkspacePreferencesPatch} patch @returns {Promise<boolean>} */
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
    return this.#writePromise || this.#startPump();
  }

  /**
   * @param {Readonly<{ intentId: string; providerId: WorkspacePreferenceAgentId; isCurrent(): boolean }>} input
   * @returns {Promise<WorkspacePreferenceMutationResult>}
   */
  commitDefaultAgent({ intentId, providerId, isCurrent }) {
    if (!String(intentId || "") || typeof isCurrent !== "function") {
      throw new TypeError("Default Agent commit requires a current intent.");
    }
    return this.#commitAgentMutation({
      intentId,
      ownedPatch: normalizeWorkspacePatch({ defaultAgentProviderId: providerId }),
      restorePatch: () => normalizeWorkspacePatch({
        defaultAgentProviderId: this.#snapshot.workspace.defaultAgentProviderId,
      }),
      isCurrent,
    });
  }

  /**
   * @param {Readonly<{ intentId: string; agentConfigurations: WorkspacePreferences["agentConfigurations"]; isCurrent(): boolean }>} input
   * @returns {Promise<WorkspacePreferenceMutationResult>}
   */
  commitAgentConfigurations({ intentId, agentConfigurations, isCurrent }) {
    if (!String(intentId || "") || typeof isCurrent !== "function") {
      throw new TypeError("Agent configuration commit requires a current intent.");
    }
    if (!validAgentConfigurations(agentConfigurations)) {
      throw new TypeError("服务配置无效。");
    }
    return this.#commitAgentMutation({
      intentId,
      ownedPatch: normalizeWorkspacePatch({ agentConfigurations }),
      restorePatch: () => normalizeWorkspacePatch({
        agentConfigurations: this.#snapshot.workspace.agentConfigurations,
      }),
      isCurrent,
    });
  }

  /**
   * @param {Readonly<{ intentId: string; providerId: WorkspacePreferenceAgentId; disabled: boolean; isCurrent(): boolean }>} input
   * @returns {Promise<WorkspacePreferenceMutationResult>}
   */
  setProviderDisabled({ intentId, providerId, disabled, isCurrent }) {
    if (!String(intentId || "") || typeof isCurrent !== "function") {
      throw new TypeError("Agent access preference commit requires a current intent.");
    }
    return this.#enqueueAgentMutation(async () => {
      if (this.#disposed || !isCurrent()) return this.#notStartedResult(intentId);
      await this.load();
      if (this.#disposed || !isCurrent()) return this.#notStartedResult(intentId);
      const previous = this.#snapshot.workspace.disabledAgentProviderIds;
      const next = disabled
        ? Array.from(new Set([...previous, providerId]))
        : previous.filter((id) => id !== providerId);
      return this.#runStartedAgentMutation({
        intentId,
        ownedPatch: normalizeWorkspacePatch({ disabledAgentProviderIds: next }),
        restorePatch: normalizeWorkspacePatch({ disabledAgentProviderIds: previous }),
        isCurrent,
      });
    });
  }

  retry() {
    if (this.#disposed || !this.#pendingPatch || !this.#port) return false;
    this.#publish({ ...this.#snapshot, saving: true, error: null });
    if (!this.#writePromise) this.#startPump();
    return true;
  }

  /** @param {{ deadlineAt?: number }} [input] */
  async flush({ deadlineAt } = {}) {
    const pending = this.#writePromise;
    if (!pending) return !this.#pendingPatch;
    if (!Number.isFinite(Number(deadlineAt))) return pending;
    const result = await Promise.race([
      pending,
      deadlinePromise(Number(deadlineAt), () => this.#clock.now()),
    ]);
    return result === true;
  }

  dispose() {
    this.#disposed = true;
    this.#listeners.clear();
    this.#pendingPatch = null;
  }

  /** @returns {Promise<boolean>} */
  #startPump() {
    // Publish the shared promise before record() can synchronously re-enter
    // update(), preserving one renderer write pump under adversarial ports.
    this.#writePromise = Promise.resolve().then(() => this.#pump());
    return this.#writePromise;
  }

  async #pump() {
    let successful = true;
    let retried = false;
    try {
      while (!this.#disposed && this.#pendingPatch) {
        const patch = this.#pendingPatch;
        const port = this.#port;
        if (!port) break;
        this.#pendingPatch = null;
        try {
          const preferences = await port.record({ workspace: patch });
          if (this.#disposed) break;
          const workspace = normalizeWorkspacePreferences(
            isRecord(preferences) ? preferences.workspace : undefined,
          );
          const pendingPatch = this.#pendingPatch;
          this.#publish({
            ...this.#snapshot,
            workspace: pendingPatch
              ? { ...workspace, .../** @type {Record<string, unknown>} */ (pendingPatch) }
              : workspace,
            saving: Boolean(pendingPatch),
            error: null,
          });
        } catch (cause) {
          this.#pendingPatch = { ...patch, ...(this.#pendingPatch || {}) };
          // Preferences are reversible. Re-read the disk receipt and retry once;
          // a matching read proves a lost response without repeating the write.
          if (!this.#disposed) {
            const authority = await this.#readAuthority();
            if (authority.ok && workspaceMatchesPatch(patch, authority.workspace)) {
              this.#dropConfirmedPendingFields(patch);
              this.#publishAuthority(authority.workspace);
              continue;
            }
            if (!retried && authority.ok) {
              retried = true;
              continue;
            }
          }
          successful = false;
          this.#publish({
            ...this.#snapshot,
            saving: false,
            error: String(
              isRecord(cause) && typeof cause.message === "string"
                ? cause.message
                : cause || "工作台偏好暂时无法保存。",
            ),
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

  /** @template T @param {() => Promise<T>} task @returns {Promise<T>} */
  #enqueueAgentMutation(task) {
    const mutation = this.#agentMutationTail.then(task, task);
    this.#agentMutationTail = mutation.catch(() => {});
    return mutation;
  }

  /**
   * @param {Readonly<{
   *   intentId: string;
   *   ownedPatch: WorkspacePreferencesPatch;
   *   restorePatch(): WorkspacePreferencesPatch;
   *   isCurrent(): boolean;
   * }>} input
   * @returns {Promise<WorkspacePreferenceMutationResult>}
   */
  #commitAgentMutation({ intentId, ownedPatch, restorePatch, isCurrent }) {
    return this.#enqueueAgentMutation(async () => {
      if (this.#disposed || !isCurrent()) return this.#notStartedResult(intentId);
      await this.load();
      if (this.#disposed || !isCurrent()) return this.#notStartedResult(intentId);
      const previous = restorePatch();
      return this.#runStartedAgentMutation({
        intentId,
        ownedPatch,
        restorePatch: previous,
        isCurrent,
      });
    });
  }

  /**
   * @param {Readonly<{
   *   intentId: string;
   *   ownedPatch: WorkspacePreferencesPatch;
   *   restorePatch: WorkspacePreferencesPatch;
   *   isCurrent(): boolean;
   * }>} input
   * @returns {Promise<WorkspacePreferenceMutationResult>}
   */
  async #runStartedAgentMutation({ intentId, ownedPatch, restorePatch, isCurrent }) {
    const saved = await this.update(ownedPatch);
    if (!saved) {
      return Object.freeze({
        status: "unknown",
        intentId,
        phase: "commit",
        pending: true,
      });
    }
    if (!this.#disposed && isCurrent()) {
      return Object.freeze({ status: "committed", intentId, persistence: "confirmed" });
    }
    const rollback = await this.#rollbackAgentMutation({ ownedPatch, restorePatch });
    if (rollback === "confirmed" || rollback === "not-needed") {
      return Object.freeze({ status: "superseded", intentId, rollback });
    }
    return Object.freeze({ status: "unknown", intentId, phase: "rollback", pending: true });
  }

  /** @param {string} intentId @returns {WorkspacePreferenceMutationResult} */
  #notStartedResult(intentId) {
    return Object.freeze({ status: "superseded", intentId, write: "not-started" });
  }

  /**
   * @param {Readonly<{ ownedPatch: WorkspacePreferencesPatch; restorePatch: WorkspacePreferencesPatch }>} input
   * @returns {Promise<"confirmed" | "not-needed" | "unknown">}
   */
  async #rollbackAgentMutation({ ownedPatch, restorePatch }) {
    const authority = await this.#readAuthority();
    if (!authority.ok) return "unknown";
    if (workspaceMatchesPatch(restorePatch, authority.workspace)) {
      this.#publishAuthority(authority.workspace);
      return "confirmed";
    }
    if (!workspaceMatchesPatch(ownedPatch, authority.workspace)) {
      this.#publishAuthority(authority.workspace);
      return "not-needed";
    }
    if (!this.#port) {
      if (!this.#disposed) {
        this.#publish({ ...this.#snapshot, workspace: { ...authority.workspace, ...restorePatch } });
      }
      return "confirmed";
    }
    try {
      const recorded = await this.#port.record({ workspace: restorePatch });
      const workspace = normalizeWorkspacePreferences(
        isRecord(recorded) ? recorded.workspace : undefined,
      );
      if (workspaceMatchesPatch(restorePatch, workspace)) {
        this.#publishAuthority(workspace);
        return "confirmed";
      }
    } catch {
      // A thrown response can still follow a completed atomic write. Only an
      // authoritative reread may call that rollback confirmed.
    }
    const reconciled = await this.#readAuthority();
    if (!reconciled.ok) return "unknown";
    if (workspaceMatchesPatch(restorePatch, reconciled.workspace)) {
      this.#publishAuthority(reconciled.workspace);
      return "confirmed";
    }
    if (!workspaceMatchesPatch(ownedPatch, reconciled.workspace)) {
      this.#publishAuthority(reconciled.workspace);
      return "not-needed";
    }
    return "unknown";
  }

  /** @returns {Promise<WorkspaceAuthorityRead>} */
  async #readAuthority() {
    if (!this.#port) {
      return Object.freeze({ ok: true, workspace: this.#snapshot.workspace });
    }
    try {
      const preferences = await this.#port.get();
      return Object.freeze({
        ok: true,
        workspace: normalizeWorkspacePreferences(
          isRecord(preferences) ? preferences.workspace : undefined,
        ),
      });
    } catch {
      return Object.freeze({ ok: false });
    }
  }

  /** @param {WorkspacePreferencesPatch} confirmedPatch */
  #dropConfirmedPendingFields(confirmedPatch) {
    if (!this.#pendingPatch) return;
    const confirmed = /** @type {Record<string, unknown>} */ (confirmedPatch);
    const remaining = Object.fromEntries(Object.entries(this.#pendingPatch).filter(
      ([key, value]) => !Object.hasOwn(confirmedPatch, key)
        || !samePreferenceValue(confirmed[key], value),
    ));
    this.#pendingPatch = Object.keys(remaining).length
      ? /** @type {WorkspacePreferencesPatch} */ (remaining)
      : null;
  }

  /** @param {WorkspacePreferences} workspace */
  #publishAuthority(workspace) {
    if (this.#disposed) return;
    this.#publish({
      ...this.#snapshot,
      workspace: this.#pendingPatch ? { ...workspace, ...this.#pendingPatch } : workspace,
      saving: Boolean(this.#pendingPatch),
      error: null,
    });
  }

  /** @param {WorkspacePreferencesSnapshot | Partial<WorkspacePreferencesSnapshot>} next */
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

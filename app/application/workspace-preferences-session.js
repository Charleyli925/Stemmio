import { normalizeAgentConfigurations, validAgentConfigurations, normalizeDocumentAgentSelections, validDocumentAgentSelections } from "../../shared/agent-configuration-preferences.mjs";

/** @typedef {import("./workspace-preferences-session.d.ts").WorkspacePreferenceAgentId} WorkspacePreferenceAgentId */
/** @typedef {import("./workspace-preferences-session.d.ts").WorkspacePreferenceMutationResult} WorkspacePreferenceMutationResult */
/** @typedef {import("./workspace-preferences-session.d.ts").WorkspacePreferences} WorkspacePreferences */
/** @typedef {import("./workspace-preferences-session.d.ts").WorkspacePreferencesPort} WorkspacePreferencesPort */
/** @typedef {import("./workspace-preferences-session.d.ts").WorkspacePreferencesSnapshot} WorkspacePreferencesSnapshot */
/** @typedef {Readonly<Partial<WorkspacePreferences>>} WorkspacePreferencesPatch */
/** @typedef {Readonly<{ now(): number }>} ClockPort */
/** @typedef {Readonly<{ ok: true; workspace: WorkspacePreferences }> | Readonly<{ ok: false }>} WorkspaceAuthorityRead */
/** @typedef {Readonly<Record<string, number>>} WorkspacePreferenceGenerations */
/** @typedef {{ attempted: Set<number>; confirmed: Set<number> }} WorkspacePreferenceOperationEvidence */
/** @typedef {Readonly<{ completion: Promise<boolean>; generations: WorkspacePreferenceGenerations }>} QueuedWorkspacePatch */

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

/** @param {unknown} value @returns {WorkspacePreferences | null} */
function strictWorkspaceReceipt(value) {
  if (!isRecord(value) || !isRecord(value.workspace)) return null;
  const source = value.workspace;
  if ([...WORKSPACE_KEYS].some((key) => !Object.hasOwn(source, key))) return null;
  const normalized = normalizeWorkspacePreferences(source);
  const record = /** @type {Record<string, unknown>} */ (normalized);
  return [...WORKSPACE_KEYS].every((key) => samePreferenceValue(source[key], record[key]))
    ? normalized
    : null;
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
  #pumpPromise = null;
  /** @type {WorkspacePreferences | null} */
  #pumpFinalAuthority = null;
  /** @type {string | null} */
  #pumpFinalError = null;
  /** @type {Promise<unknown>} */
  #writeTail = Promise.resolve();
  /** @type {Promise<unknown>} */
  #agentMutationTail = Promise.resolve();
  /** @type {WorkspacePreferencesPatch | null} */
  #pendingPatch = null;
  /** @type {Map<string, number>} */
  #pendingGenerations = new Map();
  /** @type {Map<string, number>} */
  #fieldIntentGenerations = new Map();
  /** @type {Map<string, number>} */
  #ordinaryIntentGenerations = new Map();
  /** @type {Map<number, WorkspacePreferenceOperationEvidence>} */
  #operationEvidence = new Map();
  #nextGeneration = 0;
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
    this.#advanceOrdinaryIntentGenerations(Object.keys(normalized));
    return this.#queuePatch(normalized).completion;
  }

  /**
   * @param {WorkspacePreferencesPatch} normalized
   * @param {WorkspacePreferenceOperationEvidence | null} [evidence]
   * @returns {QueuedWorkspacePatch}
   */
  #queuePatch(normalized, evidence = null) {
    const generations = this.#claimFieldGenerations(normalized);
    for (const key of Object.keys(normalized)) {
      this.#pendingGenerations.set(key, generations[key]);
      if (evidence) this.#operationEvidence.set(generations[key], evidence);
    }
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
      this.#pendingGenerations.clear();
      return Object.freeze({ completion: Promise.resolve(true), generations });
    }
    return Object.freeze({
      completion: this.#pumpPromise || this.#startPump(),
      generations,
    });
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
      restorePatch: (workspace) => normalizeWorkspacePatch({
        defaultAgentProviderId: workspace.defaultAgentProviderId,
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
      restorePatch: (workspace) => normalizeWorkspacePatch({
        agentConfigurations: workspace.agentConfigurations,
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
    if (this.#disposed || !isCurrent()) return Promise.resolve(this.#notStartedResult(intentId));
    const ordinaryFence = this.#captureOrdinaryIntentGenerations(["disabledAgentProviderIds"]);
    return this.#enqueueAgentMutation(async () => {
      if (this.#disposed || !isCurrent()) return this.#notStartedResult(intentId);
      const authority = await this.#readAgentMutationBaseline();
      if (
        this.#disposed
        || !isCurrent()
        || !this.#matchesOrdinaryIntentGenerations(ordinaryFence)
      ) return this.#notStartedResult(intentId);
      if (!authority) return this.#notWrittenResult(intentId);
      const previous = authority.disabledAgentProviderIds;
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
    if (!this.#pumpPromise) this.#startPump();
    return true;
  }

  /** @param {{ deadlineAt?: number }} [input] */
  async flush({ deadlineAt } = {}) {
    const pending = this.#pumpPromise;
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
    this.#pendingGenerations.clear();
  }

  /** @returns {Promise<boolean>} */
  #startPump() {
    const turn = this.#enqueueWriteTurn(async () => {
      // Hydration and the first user change can happen in the same turn. Let
      // the read establish the persisted baseline before the first write.
      if (!this.#snapshot.loaded && !this.#disposed) await this.load();
      return this.#pump();
    });
    /** @type {Promise<boolean>} */
    let completion;
    completion = turn.then(
      (result) => {
        if (this.#pumpPromise === completion) this.#pumpPromise = null;
        this.#settlePumpPresentation(result);
        return result;
      },
      (cause) => {
        if (this.#pumpPromise === completion) this.#pumpPromise = null;
        this.#settlePumpPresentation(false);
        throw cause;
      },
    );
    this.#pumpPromise = completion;
    return completion;
  }

  async #pump() {
    let successful = true;
    let retried = false;
    while (!this.#disposed && this.#pendingPatch) {
      const patch = this.#pendingPatch;
      const generations = this.#takePendingGenerations(patch);
      const port = this.#port;
      if (!port) break;
      this.#pendingPatch = null;
      this.#markAttempted(generations);
      try {
        const preferences = await port.record({ workspace: patch });
        const workspace = strictWorkspaceReceipt(preferences);
        if (!workspace || !workspaceMatchesPatch(patch, workspace)) {
          throw new Error("Workspace preferences write returned an invalid persistence receipt.");
        }
        this.#markConfirmed(generations);
        if (this.#disposed) break;
        this.#publishPumpAuthority(workspace);
      } catch (cause) {
        if (!this.#disposed) this.#requeuePatch(patch, generations);
        // Preferences are reversible. Re-read the disk receipt and retry once;
        // a matching read proves a lost response without repeating the write.
        if (!this.#disposed) {
          const authority = await this.#readAuthorityInTurn();
          if (authority.ok && workspaceMatchesPatch(patch, authority.workspace)) {
            this.#markConfirmed(generations);
            this.#dropConfirmedPendingFields(patch, generations);
            this.#publishPumpAuthority(authority.workspace);
            continue;
          }
          if (!retried && authority.ok) {
            retried = true;
            continue;
          }
        }
        successful = false;
        this.#pumpFinalError = String(
          isRecord(cause) && typeof cause.message === "string"
            ? cause.message
            : cause || "工作台偏好暂时无法保存。",
        );
        break;
      }
    }
    return successful && !this.#pendingPatch;
  }

  /** @param {boolean} successful */
  #settlePumpPresentation(successful) {
    const authority = this.#pumpFinalAuthority;
    const error = this.#pumpFinalError;
    this.#pumpFinalAuthority = null;
    this.#pumpFinalError = null;
    if (this.#disposed) return;
    if (authority) {
      this.#publish({
        ...this.#snapshot,
        workspace: this.#pendingPatch
          ? { ...authority, ...this.#pendingPatch }
          : authority,
        saving: Boolean(this.#pendingPatch),
        error,
      });
      return;
    }
    if (error) {
      this.#publish({ ...this.#snapshot, saving: false, error });
      return;
    }
    if (this.#pendingPatch && successful) {
      this.#publish({ ...this.#snapshot, saving: false });
    } else if (!this.#pendingPatch && this.#snapshot.saving) {
      this.#publish({ ...this.#snapshot, saving: false });
    }
  }

  /** @param {WorkspacePreferences} authority */
  #publishPumpAuthority(authority) {
    if (!this.#pendingPatch) {
      this.#pumpFinalAuthority = authority;
      this.#pumpFinalError = null;
      return;
    }
    this.#publishAuthority(authority);
  }

  /** @template T @param {() => Promise<T>} task @returns {Promise<T>} */
  #enqueueWriteTurn(task) {
    const turn = this.#writeTail.then(task, task);
    this.#writeTail = turn.catch(() => {});
    return turn;
  }

  /** @param {WorkspacePreferencesPatch} patch @returns {WorkspacePreferenceGenerations} */
  #claimFieldGenerations(patch) {
    return this.#reserveFieldGenerations(Object.keys(patch));
  }

  /** @param {readonly string[]} keys @returns {WorkspacePreferenceGenerations} */
  #reserveFieldGenerations(keys) {
    /** @type {Record<string, number>} */
    const generations = {};
    for (const key of keys) {
      const generation = ++this.#nextGeneration;
      generations[key] = generation;
      this.#fieldIntentGenerations.set(key, generation);
    }
    return Object.freeze(generations);
  }

  /** @param {readonly string[]} keys */
  #advanceOrdinaryIntentGenerations(keys) {
    for (const key of keys) {
      this.#ordinaryIntentGenerations.set(
        key,
        (this.#ordinaryIntentGenerations.get(key) || 0) + 1,
      );
    }
  }

  /** @param {readonly string[]} keys @returns {WorkspacePreferenceGenerations} */
  #captureOrdinaryIntentGenerations(keys) {
    return Object.freeze(Object.fromEntries(keys.map((key) => [
      key,
      this.#ordinaryIntentGenerations.get(key) || 0,
    ])));
  }

  /** @param {WorkspacePreferenceGenerations} fence */
  #matchesOrdinaryIntentGenerations(fence) {
    return Object.entries(fence).every(([key, generation]) => (
      (this.#ordinaryIntentGenerations.get(key) || 0) === generation
    ));
  }

  /** @param {WorkspacePreferencesPatch} patch @returns {WorkspacePreferenceGenerations} */
  #takePendingGenerations(patch) {
    /** @type {Record<string, number>} */
    const generations = {};
    for (const key of Object.keys(patch)) {
      const generation = this.#pendingGenerations.get(key);
      if (generation !== undefined) generations[key] = generation;
      if (this.#pendingGenerations.get(key) === generation) {
        this.#pendingGenerations.delete(key);
      }
    }
    return Object.freeze(generations);
  }

  /** @param {WorkspacePreferenceGenerations} generations */
  #markAttempted(generations) {
    for (const generation of Object.values(generations)) {
      this.#operationEvidence.get(generation)?.attempted.add(generation);
    }
  }

  /** @param {WorkspacePreferenceGenerations} generations */
  #markConfirmed(generations) {
    for (const generation of Object.values(generations)) {
      this.#operationEvidence.get(generation)?.confirmed.add(generation);
    }
  }

  /**
   * @param {WorkspacePreferencesPatch} patch
   * @param {WorkspacePreferenceGenerations} generations
   */
  #requeuePatch(patch, generations) {
    /** @type {Record<string, unknown>} */
    const pending = { ...(this.#pendingPatch || {}) };
    for (const [key, value] of Object.entries(patch)) {
      const generation = generations[key];
      const pendingGeneration = this.#pendingGenerations.get(key);
      if (pendingGeneration !== undefined && pendingGeneration > generation) continue;
      pending[key] = value;
      this.#pendingGenerations.set(key, generation);
    }
    this.#pendingPatch = Object.keys(pending).length
      ? /** @type {WorkspacePreferencesPatch} */ (pending)
      : null;
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
   *   restorePatch(workspace: WorkspacePreferences): WorkspacePreferencesPatch;
   *   isCurrent(): boolean;
   * }>} input
   * @returns {Promise<WorkspacePreferenceMutationResult>}
   */
  #commitAgentMutation({ intentId, ownedPatch, restorePatch, isCurrent }) {
    if (this.#disposed || !isCurrent()) return Promise.resolve(this.#notStartedResult(intentId));
    const ordinaryFence = this.#captureOrdinaryIntentGenerations(Object.keys(ownedPatch));
    return this.#enqueueAgentMutation(async () => {
      if (this.#disposed || !isCurrent()) return this.#notStartedResult(intentId);
      const authority = await this.#readAgentMutationBaseline();
      if (
        this.#disposed
        || !isCurrent()
        || !this.#matchesOrdinaryIntentGenerations(ordinaryFence)
      ) return this.#notStartedResult(intentId);
      if (!authority) return this.#notWrittenResult(intentId);
      const previous = restorePatch(authority);
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
  async #runStartedAgentMutation({
    intentId,
    ownedPatch,
    restorePatch,
    isCurrent,
  }) {
    if (!this.#port) return this.#notWrittenResult(intentId);
    /** @type {WorkspacePreferenceOperationEvidence} */
    const evidence = { attempted: new Set(), confirmed: new Set() };
    const operation = this.#queuePatch(ownedPatch, evidence);
    try {
      await operation.completion;
      let commitReconcile = "unneeded";
      if (!this.#operationConfirmed(operation.generations, evidence)) {
        commitReconcile = await this.#reconcileAgentCommit({
          ownedPatch,
          generations: operation.generations,
        });
      }
      const ownsFields = this.#ownsFieldGenerations(operation.generations);
      const current = !this.#disposed && isCurrent() && ownsFields;
      if (current && this.#operationConfirmed(operation.generations, evidence)) {
        return Object.freeze({ status: "committed", intentId, persistence: "confirmed" });
      }
      if (current) {
        if (commitReconcile === "not-written") return this.#notWrittenResult(intentId);
        return this.#unknownResult(intentId, "commit");
      }
      if (!this.#operationAttempted(operation.generations, evidence)) {
        return this.#notStartedResult(intentId);
      }
      const rollback = await this.#rollbackAgentMutation({
        ownedPatch,
        restorePatch,
        generations: operation.generations,
      });
      if (rollback === "confirmed" || rollback === "not-needed") {
        return Object.freeze({ status: "superseded", intentId, rollback });
      }
      return this.#unknownResult(
        intentId,
        this.#operationConfirmed(operation.generations, evidence) ? "rollback" : "commit",
      );
    } finally {
      for (const generation of Object.values(operation.generations)) {
        this.#operationEvidence.delete(generation);
      }
    }
  }

  /** @param {string} intentId @returns {WorkspacePreferenceMutationResult} */
  #notStartedResult(intentId) {
    return Object.freeze({ status: "superseded", intentId, write: "not-started" });
  }

  /** @param {string} intentId @returns {WorkspacePreferenceMutationResult} */
  #notWrittenResult(intentId) {
    return Object.freeze({
      status: "failed",
      intentId,
      phase: "commit",
      persistence: "not-written",
    });
  }

  /**
   * @param {string} intentId
   * @param {"commit" | "rollback"} phase
   * @returns {WorkspacePreferenceMutationResult}
   */
  #unknownResult(intentId, phase) {
    return Object.freeze({ status: "unknown", intentId, phase, pending: true });
  }

  /**
   * @param {WorkspacePreferenceGenerations} generations
   * @param {WorkspacePreferenceOperationEvidence} evidence
   */
  #operationAttempted(generations, evidence) {
    return Object.values(generations).every((generation) => evidence.attempted.has(generation));
  }

  /**
   * @param {WorkspacePreferenceGenerations} generations
   * @param {WorkspacePreferenceOperationEvidence} evidence
   */
  #operationConfirmed(generations, evidence) {
    return Object.values(generations).every((generation) => evidence.confirmed.has(generation));
  }

  /** @param {WorkspacePreferenceGenerations} generations */
  #ownsFieldGenerations(generations) {
    return Object.entries(generations).every(([key, generation]) => (
      this.#fieldIntentGenerations.get(key) === generation
    ));
  }

  /**
   * @param {Readonly<{
   *   ownedPatch: WorkspacePreferencesPatch;
   *   generations: WorkspacePreferenceGenerations;
   * }>} input
   * @returns {Promise<"confirmed" | "not-written" | "unknown">}
   */
  #reconcileAgentCommit({ ownedPatch, generations }) {
    return this.#enqueueWriteTurn(async () => {
      const authority = await this.#readAuthorityInTurn();
      if (!authority.ok) return "unknown";
      this.#publishAuthority(authority.workspace);
      if (!workspaceMatchesPatch(ownedPatch, authority.workspace)) return "not-written";
      this.#markConfirmed(generations);
      return "confirmed";
    });
  }

  /** @returns {Promise<WorkspacePreferences | null>} */
  #readAgentMutationBaseline() {
    return this.#enqueueWriteTurn(async () => {
      const authority = await this.#readAuthorityInTurn();
      if (!authority.ok) return null;
      if (!this.#disposed) {
        this.#publish({
          ...this.#snapshot,
          loaded: true,
          workspace: this.#pendingPatch
            ? { ...authority.workspace, ...this.#pendingPatch }
            : authority.workspace,
          saving: Boolean(this.#pendingPatch),
          error: null,
        });
      }
      return authority.workspace;
    });
  }

  /**
   * @param {Readonly<{
   *   ownedPatch: WorkspacePreferencesPatch;
   *   restorePatch: WorkspacePreferencesPatch;
   *   generations: WorkspacePreferenceGenerations;
   * }>} input
   * @returns {Promise<"confirmed" | "not-needed" | "unknown">}
   */
  #rollbackAgentMutation({ ownedPatch, restorePatch, generations }) {
    return this.#enqueueWriteTurn(async () => {
      const authority = await this.#readAuthorityInTurn();
      if (!authority.ok) return "unknown";
      if (workspaceMatchesPatch(restorePatch, authority.workspace)) {
        return this.#finishSupersededAgentMutation("confirmed", authority.workspace, ownedPatch, generations);
      }
      if (!workspaceMatchesPatch(ownedPatch, authority.workspace)) {
        return this.#finishSupersededAgentMutation("not-needed", authority.workspace, ownedPatch, generations);
      }
      this.#markConfirmed(generations);
      // update() claims fields synchronously. A same-field intent arriving
      // while get() was in flight owns the next durable turn, so this rollback
      // must not overwrite it. There is intentionally no await between this
      // fence and the record() call.
      if (!this.#ownsFieldGenerations(generations)) {
        return this.#finishSupersededAgentMutation("not-needed", authority.workspace, ownedPatch, generations);
      }
      const port = this.#port;
      if (!port) return "unknown";
      try {
        const recorded = await port.record({ workspace: restorePatch });
        const workspace = strictWorkspaceReceipt(recorded);
        if (workspace && workspaceMatchesPatch(restorePatch, workspace)) {
          return this.#finishSupersededAgentMutation("confirmed", workspace, ownedPatch, generations);
        }
      } catch {
        // A thrown response can still follow a completed atomic write. Only an
        // authoritative reread may call that rollback confirmed.
      }
      const reconciled = await this.#readAuthorityInTurn();
      if (!reconciled.ok) return "unknown";
      if (workspaceMatchesPatch(restorePatch, reconciled.workspace)) {
        return this.#finishSupersededAgentMutation("confirmed", reconciled.workspace, ownedPatch, generations);
      }
      if (!workspaceMatchesPatch(ownedPatch, reconciled.workspace)) {
        return this.#finishSupersededAgentMutation("not-needed", reconciled.workspace, ownedPatch, generations);
      }
      if (!this.#ownsFieldGenerations(generations)) {
        return this.#finishSupersededAgentMutation("not-needed", reconciled.workspace, ownedPatch, generations);
      }
      return "unknown";
    });
  }

  /**
   * @param {"confirmed" | "not-needed"} outcome
   * @param {WorkspacePreferences} authority
   * @param {WorkspacePreferencesPatch} ownedPatch
   * @param {WorkspacePreferenceGenerations} generations
   */
  #finishSupersededAgentMutation(outcome, authority, ownedPatch, generations) {
    this.#dropConfirmedPendingFields(ownedPatch, generations);
    this.#publishAuthority(authority);
    return outcome;
  }

  /** @returns {Promise<WorkspaceAuthorityRead>} */
  async #readAuthorityInTurn() {
    if (!this.#port) return Object.freeze({ ok: false });
    try {
      const preferences = await this.#port.get();
      const workspace = strictWorkspaceReceipt(preferences);
      return workspace
        ? Object.freeze({ ok: true, workspace })
        : Object.freeze({ ok: false });
    } catch {
      return Object.freeze({ ok: false });
    }
  }

  /**
   * @param {WorkspacePreferencesPatch} confirmedPatch
   * @param {WorkspacePreferenceGenerations} generations
   */
  #dropConfirmedPendingFields(confirmedPatch, generations) {
    if (!this.#pendingPatch) return;
    const confirmed = /** @type {Record<string, unknown>} */ (confirmedPatch);
    const remaining = Object.fromEntries(Object.entries(this.#pendingPatch).filter(
      ([key, value]) => this.#pendingGenerations.get(key) !== generations[key]
        || !Object.hasOwn(confirmedPatch, key)
        || !samePreferenceValue(confirmed[key], value),
    ));
    for (const key of Object.keys(confirmedPatch)) {
      if (this.#pendingGenerations.get(key) === generations[key]) {
        this.#pendingGenerations.delete(key);
      }
    }
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

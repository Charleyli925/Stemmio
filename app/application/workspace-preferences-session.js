import {
  WORKSPACE_PREFERENCE_DEFAULTS as DEFAULT_WORKSPACE_PREFERENCES,
  normalizeWorkspacePatch,
  normalizeWorkspacePreferences,
} from "../../shared/workspace-preferences.mjs";
import { validAgentConfigurations } from "../../shared/agent-configuration-preferences.mjs";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
      const restored = await this.#rollbackAgentMutation({ defaultAgentProviderId: previousProviderId });
      return Object.freeze({ status: restored ? "superseded" : "failed" });
    });
  }

  commitAgentConfigurations({ intentId, agentConfigurations, isCurrent }) {
    if (!String(intentId || "") || typeof isCurrent !== "function") {
      throw new TypeError("Agent configuration commit requires a current intent.");
    }
    if (!validAgentConfigurations(agentConfigurations)) {
      throw new TypeError("服务配置无效。");
    }
    return this.#enqueueAgentMutation(async () => {
      await this.load();
      if (!isCurrent()) return Object.freeze({ status: "superseded" });
      const previous = this.#snapshot.workspace.agentConfigurations;
      const saved = await this.update({ agentConfigurations });
      if (!saved) return Object.freeze({ status: "failed" });
      if (isCurrent()) return Object.freeze({ status: "committed" });
      const restored = await this.#rollbackAgentMutation({ agentConfigurations: previous });
      return Object.freeze({ status: restored ? "superseded" : "failed" });
    });
  }

  setProviderDisabled({ intentId, providerId, disabled, isCurrent }) {
    if (!String(intentId || "") || typeof isCurrent !== "function") {
      throw new TypeError("Agent access preference commit requires a current intent.");
    }
    return this.#enqueueAgentMutation(async () => {
      await this.load();
      if (!isCurrent()) return Object.freeze({ status: "superseded" });
      const current = this.#snapshot.workspace.disabledAgentProviderIds;
      const next = disabled
        ? Array.from(new Set([...current, providerId]))
        : current.filter((id) => id !== providerId);
      const saved = await this.update({ disabledAgentProviderIds: next });
      if (!saved) return Object.freeze({ status: "failed" });
      if (isCurrent()) return Object.freeze({ status: "committed" });
      const restored = await this.#rollbackAgentMutation({ disabledAgentProviderIds: current });
      return Object.freeze({ status: restored ? "superseded" : "failed" });
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

  async #rollbackAgentMutation(patch) {
    const normalized = normalizeWorkspacePatch(patch);
    if (!this.#disposed) return this.update(normalized);
    if (!this.#port) return true;
    // Disposal closes public preference writes and presentation, but an Agent
    // mutation whose first durable write already started still owns its fixed
    // rollback. Complete that rollback directly without reopening the Session
    // pump or publishing a disposed snapshot.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await this.#port.record({ workspace: normalized });
        return true;
      } catch {
        if (attempt === 0) await this.#port.get().catch(() => {});
      }
    }
    return false;
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

import { isBridgeRequestError } from "./bridge-client.js";
import { isProjectSurfaceContext } from "./project-surface-context.js";

const AUTOSAVE_DELAY_MS = 700;

function succeeded(value) {
  return Object.freeze({ status: "succeeded", value });
}

function blocked(code, reason) {
  return Object.freeze({
    status: "blocked",
    code: String(code),
    reason: String(reason),
  });
}

function rejected(code, reason) {
  return Object.freeze({
    status: "rejected",
    code: String(code),
    reason: String(reason),
  });
}

function unknown(operationId, reason) {
  return Object.freeze({
    status: "unknown",
    operationId: String(operationId),
    reason: String(reason),
  });
}

function stale(context) {
  return Object.freeze({
    status: "stale",
    identity: Object.freeze({
      epoch: Number(context?.epoch || 0),
      projectId: String(context?.projectId || ""),
      documentId: String(context?.documentId || ""),
      sourcePath: String(context?.sourcePath || ""),
    }),
  });
}

function bridgeErrorCode(cause, fallback) {
  if (isBridgeRequestError(cause) && cause.code) return cause.code;
  return cause && typeof cause === "object" && cause.code
    ? String(cause.code)
    : fallback;
}

function autosaveKey(snapshot) {
  return [
    snapshot.open ? "open" : "closed",
    snapshot.loading ? "loading" : "ready",
    snapshot.saving ? "saving" : "idle",
    snapshot.compositionActive ? "composition" : "plain",
    snapshot.editorGeneration,
    snapshot.content,
    snapshot.savedContent,
  ].join("\u0000");
}

// ProjectRulesWorkflow owns PROJECT.md Bridge I/O, delayed autosave and
// unknown-write reconciliation. ProjectRulesSession remains the single owner
// of the editor's mutable working-copy, composition and save projection facts.
export class ProjectRulesWorkflow {
  #bridgeClient;

  #projectSession;

  #runSession;

  #projectRulesSession;

  #errorMessage;

  #scheduler;

  #clock;

  #listeners = new Set();

  #sessionUnsubscribe = null;

  #runSessionUnsubscribe = null;

  #snapshot;

  #autosaveTimer = null;

  #autosaveKey = null;

  #savePromise = null;

  #saveSequence = 0;

  #disposed = false;

  constructor({
    bridgeClient,
    projectSession,
    runSession,
    projectRulesSession,
    errorMessage = (cause, fallback) => (
      cause instanceof Error && cause.message ? cause.message : fallback
    ),
    scheduler = globalThis,
    clock,
  } = {}) {
    if (
      !bridgeClient
      || typeof bridgeClient.projectFile !== "function"
      || typeof bridgeClient.updateProjectFile !== "function"
    ) {
      throw new TypeError("ProjectRulesWorkflow requires project-file Bridge commands.");
    }
    if (!projectSession || typeof projectSession.matches !== "function") {
      throw new TypeError("ProjectRulesWorkflow requires ProjectSession injection.");
    }
    if (
      !runSession
      || typeof runSession.subscribe !== "function"
      || typeof runSession.activeLocked !== "boolean"
    ) {
      throw new TypeError("ProjectRulesWorkflow requires RunSession injection.");
    }
    if (
      !projectRulesSession
      || typeof projectRulesSession.subscribe !== "function"
      || typeof projectRulesSession.beginOpen !== "function"
      || typeof projectRulesSession.beginSave !== "function"
      || typeof projectRulesSession.inspect !== "function"
    ) {
      throw new TypeError("ProjectRulesWorkflow requires ProjectRulesSession injection.");
    }
    if (
      !scheduler
      || typeof scheduler.setTimeout !== "function"
      || typeof scheduler.clearTimeout !== "function"
    ) {
      throw new TypeError("ProjectRulesWorkflow requires a SchedulerPort.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("ProjectRulesWorkflow requires a ClockPort.");
    }
    this.#bridgeClient = bridgeClient;
    this.#projectSession = projectSession;
    this.#runSession = runSession;
    this.#projectRulesSession = projectRulesSession;
    this.#errorMessage = errorMessage;
    this.#scheduler = scheduler;
    this.#clock = clock;
    this.#snapshot = projectRulesSession.snapshot;
    this.#sessionUnsubscribe = projectRulesSession.subscribe((snapshot) => {
      this.#snapshot = snapshot;
      this.#publishSnapshot();
      this.#syncAutosave();
    });
    this.#runSessionUnsubscribe = runSession.subscribe(() => {
      this.#syncAutosave();
    });
  }

  getSnapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("ProjectRulesWorkflow listener must be a function.");
    }
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  dispose() {
    this.#disposed = true;
    this.#clearAutosaveTimer();
    this.#sessionUnsubscribe?.();
    this.#sessionUnsubscribe = null;
    this.#runSessionUnsubscribe?.();
    this.#runSessionUnsubscribe = null;
    this.#listeners.clear();
  }

  async open({ context } = {}) {
    if (this.#disposed) {
      return blocked("PROJECT_RULES_WORKFLOW_DISPOSED", "项目规则工作流已经停止。");
    }
    if (!this.#acceptsContext(context)) return stale(context);
    if (
      this.#snapshot.open
      && !this.#snapshot.error
      && this.#projectRulesSession.matchesContext(context)
    ) {
      return succeeded({ opened: true, reused: true });
    }
    if (this.#snapshot.open && !this.#projectRulesSession.matchesContext(context)) {
      const drained = await this.drain();
      if (!drained) {
        return blocked(
          "PROJECT_RULES_SWITCH_BLOCKED",
          "当前长期规则尚未完成安全保存。",
        );
      }
    }
    this.#clearAutosaveTimer();
    const token = this.#projectRulesSession.beginOpen(context);
    if (!token) {
      return blocked("PROJECT_RULES_CONTEXT_REQUIRED", "当前项目身份尚未完成初始化。");
    }
    try {
      const payload = await this.#bridgeClient.projectFile(
        token.context.sourcePath,
        "PROJECT.md",
      );
      if (!this.#isCurrent(token)) return stale(token.context);
      if (!this.#projectRulesSession.completeOpen(token, payload)) {
        return stale(token.context);
      }
      return succeeded({ opened: true, reused: false });
    } catch (cause) {
      if (!this.#isCurrent(token)) return stale(token.context);
      const reason = this.#errorMessage(
        cause,
        "长期规则暂时无法读取；未显示任何可编辑的替代内容。",
      );
      this.#projectRulesSession.failOpen(token, reason);
      return rejected(bridgeErrorCode(cause, "PROJECT_RULES_READ_FAILED"), reason);
    }
  }

  updateContent({ content } = {}) {
    if (this.#disposed) {
      return blocked("PROJECT_RULES_WORKFLOW_DISPOSED", "项目规则工作流已经停止。");
    }
    if (this.#runLockedForContext()) {
      return blocked("PROJECT_RULES_RUN_LOCKED", "AI 处理期间不能修改项目规则。");
    }
    if (!this.#projectRulesSession.updateContent(String(content ?? ""))) {
      return blocked("PROJECT_RULES_EDIT_UNAVAILABLE", "项目规则尚未完成读取，暂时不能编辑。");
    }
    return succeeded({ updated: true });
  }

  beginComposition({ target, baselineValue } = {}) {
    if (this.#disposed || this.#runLockedForContext()) return null;
    return this.#projectRulesSession.beginComposition(target, String(baselineValue ?? ""));
  }

  finishComposition({ target } = {}) {
    if (this.#disposed) return false;
    return this.#projectRulesSession.finishComposition(target);
  }

  leaveEditor() {
    if (this.#disposed) return false;
    return this.#projectRulesSession.leaveEditor();
  }

  restore() {
    if (this.#disposed) {
      return blocked("PROJECT_RULES_WORKFLOW_DISPOSED", "项目规则工作流已经停止。");
    }
    if (this.#runLockedForContext()) {
      return blocked("PROJECT_RULES_RUN_LOCKED", "AI 处理期间不能还原项目规则。");
    }
    const restore = this.#projectRulesSession.restore();
    if (!restore) {
      return blocked("PROJECT_RULES_RESTORE_UNAVAILABLE", "项目规则尚未完成读取，暂时不能还原。");
    }
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      if (!this.#disposed) {
        this.#projectRulesSession.settleRestore(restore.compositionEpoch);
      }
    };
    settle();
    return succeeded({ restored: true, editorGeneration: restore.editorGeneration });
  }

  save() {
    if (this.#disposed) {
      return Promise.resolve(blocked(
        "PROJECT_RULES_WORKFLOW_DISPOSED",
        "项目规则工作流已经停止。",
      ));
    }
    if (this.#savePromise) return this.#savePromise;
    if (!this.#snapshot.open) return Promise.resolve(succeeded({ saved: false }));
    const context = this.#projectRulesSession.context;
    if (!context || !this.#acceptsContext(context)) {
      return Promise.resolve(stale(context));
    }
    if (this.#snapshot.loading || this.#snapshot.error) {
      return Promise.resolve(blocked(
        "PROJECT_RULES_SAVE_UNAVAILABLE",
        this.#snapshot.error || "项目规则尚未完成读取，暂时不能保存。",
      ));
    }
    if (this.#runLockedForContext()) {
      return Promise.resolve(blocked(
        "PROJECT_RULES_RUN_LOCKED",
        "AI 处理期间不能保存项目规则。",
      ));
    }
    if (this.#projectRulesSession.compositionActive) {
      return Promise.resolve(blocked(
        "PROJECT_RULES_COMPOSITION_ACTIVE",
        "项目规则仍在输入中，请先完成当前文字输入。",
      ));
    }
    if (this.#snapshot.content === this.#snapshot.savedContent) {
      return Promise.resolve(succeeded({ saved: false }));
    }
    this.#clearAutosaveTimer();
    const token = this.#projectRulesSession.beginSave();
    if (!token) {
      return Promise.resolve(blocked(
        "PROJECT_RULES_SAVE_UNAVAILABLE",
        "项目规则当前不能开始保存。",
      ));
    }
    const operationId = this.#nextOperationId();
    const save = this.#persist({ ...token, operationId });
    this.#savePromise = save;
    save.finally(() => {
      if (this.#savePromise === save) this.#savePromise = null;
    }).catch(() => {
      // #persist converts every Bridge outcome into a typed result.
    });
    return save;
  }

  async close() {
    if (this.#disposed) {
      return blocked("PROJECT_RULES_WORKFLOW_DISPOSED", "项目规则工作流已经停止。");
    }
    if (!this.#snapshot.open) return succeeded({ closed: false });
    if (!this.#snapshot.error && !await this.drain()) {
      const inspection = this.inspect();
      return blocked(
        "PROJECT_RULES_CLOSE_BLOCKED",
        inspection.state === "resolved"
          ? "项目规则没有完成安全保存。"
          : inspection.reason,
      );
    }
    this.#clearAutosaveTimer();
    this.#projectRulesSession.close();
    return succeeded({ closed: true });
  }

  resetForProjectTransition() {
    if (this.#disposed) return;
    this.#clearAutosaveTimer();
    // A source transition fences the Session generation. Do not make the next
    // project wait for an old, already-stale write promise before it can save.
    this.#savePromise = null;
    this.#projectRulesSession.close();
  }

  inspect() {
    return this.#projectRulesSession.inspect({
      locked: this.#runLockedForContext(),
    });
  }

  async drain() {
    for (;;) {
      const inspection = this.inspect();
      if (inspection.state === "resolved") return true;
      if (inspection.state === "blocked") return false;
      const outcome = await this.save();
      if (outcome.status !== "succeeded") return false;
      // A user input can arrive while the prior write was in flight. Reinspect
      // and carry the same drain through the newest working copy instead of
      // allowing a close/switch to discard it after the older acknowledgement.
    }
  }

  async #persist(token) {
    try {
      await this.#bridgeClient.updateProjectFile({
        sourcePath: token.context.sourcePath,
        projectId: token.context.projectId,
        documentId: token.context.documentId,
        content: token.content,
      });
      if (!this.#isCurrent(token)) {
        this.#projectRulesSession.abandonSave(token);
        return stale(token.context);
      }
      if (!this.#projectRulesSession.completeSave(token)) return stale(token.context);
      return succeeded({ saved: true, reconciled: false });
    } catch (cause) {
      if (!this.#isCurrent(token)) {
        this.#projectRulesSession.abandonSave(token);
        return stale(token.context);
      }
      let reconciliationFailed = false;
      try {
        const persisted = await this.#bridgeClient.projectFile(
          token.context.sourcePath,
          "PROJECT.md",
        );
        if (!this.#isCurrent(token)) {
          this.#projectRulesSession.abandonSave(token);
          return stale(token.context);
        }
        if (String(persisted?.content || "") === token.content) {
          this.#projectRulesSession.completeSave(token);
          return succeeded({ saved: true, reconciled: true });
        }
      } catch {
        reconciliationFailed = true;
      }
      if (!this.#isCurrent(token)) {
        this.#projectRulesSession.abandonSave(token);
        return stale(token.context);
      }
      const reason = this.#errorMessage(
        cause,
        "项目规则暂时没有保存；内容仍保留在这里，可以再次保存。",
      );
      this.#projectRulesSession.failSave(token, reason);
      if (isBridgeRequestError(cause) && cause.outcome === "unknown" && reconciliationFailed) {
        return unknown(token.operationId, reason);
      }
      return rejected(bridgeErrorCode(cause, "PROJECT_RULES_SAVE_FAILED"), reason);
    }
  }

  #isCurrent(token) {
    return Boolean(
      !this.#disposed
      && this.#projectRulesSession.isCurrent(token)
      && this.#acceptsContext(token.context),
    );
  }

  retry() {
    const context = this.#projectRulesSession.context;
    return context
      ? this.open({ context })
      : Promise.resolve(blocked(
        "PROJECT_RULES_CONTEXT_REQUIRED",
        "当前长期规则没有可重试的项目身份。",
      ));
  }

  #acceptsContext(context) {
    return Boolean(
      context
      && (isProjectSurfaceContext(context) || this.#projectSession.matches(context)),
    );
  }

  #runLockedForContext(context = this.#projectRulesSession.context) {
    if (!this.#runSession.activeLocked) return false;
    const activeRun = this.#runSession.activeRun;
    if (!context || !activeRun) return true;
    return activeRun.projectId && activeRun.documentId
      ? activeRun.projectId === context.projectId
        && activeRun.documentId === context.documentId
      : activeRun.sourcePath === context.sourcePath;
  }

  #nextOperationId() {
    this.#saveSequence += 1;
    return [
      "project-rules-save",
      Math.max(0, Number(this.#clock.now()) || 0).toString(36),
      this.#saveSequence.toString(36),
    ].join("_");
  }

  #publishSnapshot() {
    if (this.#disposed) return;
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // Presentation listeners cannot change project-rule authority.
      }
    }
  }

  #clearAutosaveTimer() {
    if (this.#autosaveTimer !== null) {
      this.#scheduler.clearTimeout(this.#autosaveTimer);
      this.#autosaveTimer = null;
    }
    this.#autosaveKey = null;
  }

  #syncAutosave() {
    if (this.#disposed) return;
    const snapshot = this.#snapshot;
    const eligible = Boolean(
      snapshot.open
      && !snapshot.loading
      && !snapshot.error
      && !snapshot.saving
      && !snapshot.compositionActive
      && !this.#runLockedForContext()
      && snapshot.content !== snapshot.savedContent,
    );
    if (!eligible) {
      this.#clearAutosaveTimer();
      return;
    }
    const key = autosaveKey(snapshot);
    if (this.#autosaveTimer !== null && this.#autosaveKey === key) return;
    this.#clearAutosaveTimer();
    this.#autosaveKey = key;
    this.#autosaveTimer = this.#scheduler.setTimeout(() => {
      this.#autosaveTimer = null;
      if (this.#disposed || this.#autosaveKey !== key) return;
      this.#autosaveKey = null;
      void this.save();
    }, AUTOSAVE_DELAY_MS);
  }
}

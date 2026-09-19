import {
  copyProjectSurfaceContext,
  isProjectSurfaceContext,
} from "./project-surface-context.js";

function copyContext(context) {
  const surface = copyProjectSurfaceContext(context);
  if (surface) return surface;
  if (
    !context
    || !Number.isSafeInteger(Number(context.epoch))
    || !String(context.projectId || "")
    || !String(context.documentId || "")
    || !String(context.sourcePath || "")
  ) {
    return null;
  }
  return Object.freeze({
    epoch: Number(context.epoch),
    projectId: String(context.projectId),
    documentId: String(context.documentId),
    sourcePath: String(context.sourcePath),
  });
}

function sameContext(left, right) {
  if (isProjectSurfaceContext(left) || isProjectSurfaceContext(right)) {
    return Boolean(
      isProjectSurfaceContext(left)
      && isProjectSurfaceContext(right)
      && left.surfaceContextId === right.surfaceContextId,
    );
  }
  return Boolean(
    left
    && right
    && left.epoch === right.epoch
    && left.projectId === right.projectId
    && left.documentId === right.documentId
    && left.sourcePath === right.sourcePath,
  );
}

function emptySnapshot(editorGeneration = 0) {
  return Object.freeze({
    open: false,
    path: "PROJECT.md",
    content: "",
    savedContent: "",
    loading: false,
    error: "",
    saving: false,
    saveError: "",
    compositionActive: false,
    editorGeneration,
  });
}

function operationToken(context, generation, content = undefined) {
  return Object.freeze({
    context,
    generation,
    ...(content === undefined ? {} : { content: String(content) }),
  });
}

// ProjectRulesSession owns only the disposable editor facts. Bridge reads,
// writes, delayed autosave and unknown-outcome reconciliation belong to
// ProjectRulesWorkflow so this Session never becomes an IO owner.
export class ProjectRulesSession {
  #context = null;

  #generation = 0;

  #compositionSequence = 0;

  #composition = null;

  #snapshot = emptySnapshot();

  #listeners = new Set();

  #emit(next) {
    this.#snapshot = Object.freeze({ ...next });
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // Presentation and workflow listeners cannot change rule authority.
      }
    }
  }

  #isCurrent(context, generation) {
    return generation === this.#generation
      && sameContext(this.#context, context);
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("ProjectRulesSession listener must be a function.");
    }
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  beginOpen(context) {
    const nextContext = copyContext(context);
    if (!nextContext) {
      this.close();
      return null;
    }
    this.#generation += 1;
    const generation = this.#generation;
    this.#context = nextContext;
    this.#composition = null;
    this.#emit({
      ...emptySnapshot(this.#snapshot.editorGeneration),
      open: true,
      loading: true,
      content: "正在读取…",
      savedContent: "正在读取…",
    });
    return operationToken(nextContext, generation);
  }

  commitOpen(context, payload) {
    const nextContext = copyContext(context);
    if (!nextContext) return false;
    this.#generation += 1;
    this.#context = nextContext;
    this.#composition = null;
    const content = String(payload?.content || "");
    this.#emit({
      ...emptySnapshot(this.#snapshot.editorGeneration),
      open: true,
      content,
      savedContent: content,
    });
    return true;
  }

  completeOpen(token, payload) {
    if (!this.isCurrent(token)) return false;
    const content = String(payload?.content || "");
    this.#emit({
      ...this.#snapshot,
      content,
      savedContent: content,
      loading: false,
      error: "",
    });
    return true;
  }

  failOpen(token, error) {
    if (!this.isCurrent(token)) return false;
    this.#emit({
      ...this.#snapshot,
      content: "",
      savedContent: "",
      loading: false,
      error: String(error || "长期规则暂时无法读取；未显示任何可编辑的替代内容。"),
    });
    return true;
  }

  close() {
    this.#generation += 1;
    this.#context = null;
    this.#composition = null;
    this.#emit(emptySnapshot(this.#snapshot.editorGeneration));
  }

  matchesContext(context) {
    return sameContext(this.#context, copyContext(context));
  }

  isCurrent(token) {
    return Boolean(
      token
      && this.#isCurrent(token.context, Number(token.generation)),
    );
  }

  updateContent(content) {
    if (
      !this.#snapshot.open
      || this.#snapshot.loading
      || this.#snapshot.error
      || this.#composition?.restoreRequested
    ) return false;
    this.#emit({
      ...this.#snapshot,
      content: String(content),
      saveError: "",
    });
    return true;
  }

  beginComposition(target, baselineValue) {
    if (
      !this.#snapshot.open
      || this.#snapshot.loading
      || this.#snapshot.error
    ) return null;
    this.#compositionSequence += 1;
    this.#composition = {
      epoch: this.#compositionSequence,
      target,
      baselineValue: String(baselineValue),
      restoreRequested: false,
    };
    this.#emit({ ...this.#snapshot, compositionActive: true });
    return this.#composition.epoch;
  }

  finishComposition(target) {
    const active = this.#composition;
    if (!active || active.target !== target) return false;
    if (!active.restoreRequested) {
      this.#composition = null;
      this.#emit({ ...this.#snapshot, compositionActive: false });
    }
    return true;
  }

  leaveEditor() {
    const active = this.#composition;
    if (!active) return false;
    this.#composition = null;
    this.#emit({
      ...this.#snapshot,
      compositionActive: false,
      ...(active.restoreRequested
        ? {}
        : { content: active.baselineValue }),
    });
    return true;
  }

  restore() {
    if (!this.#snapshot.open || this.#snapshot.loading || this.#snapshot.error) {
      return null;
    }
    const active = this.#composition;
    if (active) active.restoreRequested = true;
    this.#emit({
      ...this.#snapshot,
      content: this.#snapshot.savedContent,
      saveError: "",
      compositionActive: false,
      editorGeneration: this.#snapshot.editorGeneration + 1,
    });
    return Object.freeze({
      compositionEpoch: active?.epoch ?? null,
      editorGeneration: this.#snapshot.editorGeneration,
    });
  }

  settleRestore(compositionEpoch) {
    if (
      compositionEpoch !== null
      && this.#composition?.epoch === compositionEpoch
    ) {
      this.#composition = null;
      return true;
    }
    return false;
  }

  beginSave() {
    if (
      !this.#snapshot.open
      || this.#snapshot.loading
      || this.#snapshot.error
      || this.#snapshot.saving
      || this.#composition
      || !this.#context
      || this.#snapshot.content === this.#snapshot.savedContent
    ) return null;
    const token = operationToken(
      this.#context,
      this.#generation,
      this.#snapshot.content,
    );
    this.#emit({ ...this.#snapshot, saving: true, saveError: "" });
    return token;
  }

  completeSave(token) {
    if (!this.isCurrent(token) || !this.#snapshot.saving) return false;
    this.#emit({
      ...this.#snapshot,
      savedContent: token.content,
      saving: false,
      saveError: "",
    });
    return true;
  }

  failSave(token, error) {
    if (!this.isCurrent(token) || !this.#snapshot.saving) return false;
    this.#emit({
      ...this.#snapshot,
      saving: false,
      saveError: String(error || "项目规则暂时没有保存；内容仍保留在这里，可以再次保存。"),
    });
    return true;
  }

  abandonSave(token) {
    if (!this.isCurrent(token) || !this.#snapshot.saving) return false;
    this.#emit({ ...this.#snapshot, saving: false });
    return true;
  }

  get compositionActive() {
    return Boolean(this.#composition);
  }

  get context() {
    return this.#context;
  }

  inspect({ locked = false } = {}) {
    if (!this.#snapshot.open) return { state: "resolved" };
    if (this.#snapshot.error) {
      return {
        state: "blocked",
        reason: this.#snapshot.error,
      };
    }
    if (locked && this.#snapshot.content !== this.#snapshot.savedContent) {
      return {
        state: "blocked",
        reason: "AI 处理期间不能保存项目规则。",
      };
    }
    if (
      this.#composition
      || this.#snapshot.saving
      || this.#snapshot.content !== this.#snapshot.savedContent
    ) {
      return {
        state: "pending",
        reason: this.#composition
          ? "项目规则仍在输入中。"
          : "项目规则尚未保存。",
      };
    }
    return { state: "resolved" };
  }

  get snapshot() {
    return this.#snapshot;
  }
}

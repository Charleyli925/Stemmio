const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const UNKNOWN_HOST_CODES = new Set([
  "INVALID_PROJECT_RESPONSE",
  "PROJECT_SERVICE_UNAVAILABLE",
]);

function succeeded(value) {
  return Object.freeze({ status: "succeeded", value });
}

function blocked(code, reason) {
  return Object.freeze({ status: "blocked", code, reason });
}

function rejected(code, reason) {
  return Object.freeze({ status: "rejected", code, reason });
}

function unknown(operationId, reason) {
  return Object.freeze({ status: "unknown", operationId, reason });
}

function stale(identity) {
  return Object.freeze({ status: "stale", identity });
}

function copyContext(context) {
  return context ? Object.freeze({ ...context }) : null;
}

function stableIdentity(context) {
  return Object.freeze({
    epoch: context.epoch,
    projectId: context.projectId,
    documentId: context.documentId,
    sourcePath: context.sourcePath,
  });
}

function errorCode(cause, fallback) {
  return typeof cause?.code === "string" && cause.code
    ? cause.code
    : fallback;
}

export class BrowserOpenWorkflow {
  #projectSession;

  #documentSession;

  #versionSession;

  #documentWorkflow;

  #canvasPort;

  #filePort;

  #errorMessage;

  #clock;

  #sequence = 0;

  #active = null;

  #disposed = false;

  constructor({
    projectSession,
    documentSession,
    versionSession,
    documentWorkflow,
    ports,
    errorMessage = (cause, fallback) => String(cause?.message || cause || fallback),
    clock = { now: () => Date.now() },
  } = {}) {
    if (!projectSession || typeof projectSession.matches !== "function") {
      throw new TypeError("BrowserOpenWorkflow requires ProjectSession.");
    }
    if (!documentSession?.snapshot) {
      throw new TypeError("BrowserOpenWorkflow requires DocumentSession.");
    }
    if (
      !documentWorkflow
      || typeof documentWorkflow.enqueueEdit !== "function"
      || typeof documentWorkflow.flush !== "function"
    ) {
      throw new TypeError("BrowserOpenWorkflow requires DocumentWorkflow.");
    }
    if (!versionSession?.snapshot) {
      throw new TypeError("BrowserOpenWorkflow requires VersionSession.");
    }
    if (typeof ports?.canvas?.checkpointSource !== "function") {
      throw new TypeError("BrowserOpenWorkflow requires a Canvas checkpoint port.");
    }
    if (typeof ports?.files?.openInDefaultBrowser !== "function") {
      throw new TypeError("BrowserOpenWorkflow requires a desktop browser-open port.");
    }
    this.#projectSession = projectSession;
    this.#documentSession = documentSession;
    this.#versionSession = versionSession;
    this.#documentWorkflow = documentWorkflow;
    this.#canvasPort = ports.canvas;
    this.#filePort = ports.files;
    this.#errorMessage = errorMessage;
    this.#clock = clock;
  }

  dispose() {
    this.#disposed = true;
  }

  openSelectedDocument() {
    const captured = this.#captureTarget();
    if (captured.status !== "succeeded") return Promise.resolve(captured);
    const target = captured.value;
    if (this.#active) {
      return this.#active.key === target.key
        ? this.#active.promise
        : Promise.resolve(blocked(
          "BROWSER_OPEN_BUSY",
          "另一份文档正在交给系统浏览器，请稍后重试。",
        ));
    }
    const operationId = `browser-open_${this.#clock.now()}_${++this.#sequence}`;
    const promise = this.#openTarget(target, operationId).finally(() => {
      if (this.#active?.promise === promise) this.#active = null;
    });
    this.#active = Object.freeze({ key: target.key, promise });
    return promise;
  }

  #captureTarget() {
    if (this.#disposed) {
      return blocked("BROWSER_OPEN_DISPOSED", "浏览器打开工作流已经停止。");
    }
    const context = copyContext(this.#projectSession.context);
    if (!context?.sourcePath || !this.#projectSession.matches(context)) {
      return blocked("BROWSER_OPEN_CONTEXT_REQUIRED", "当前页面没有可验证的 HTML 文件。");
    }
    const version = this.#versionSession.snapshot;
    if (version.viewMode === "history") {
      const history = version.historyPreview;
      if (
        !history
        || history.projectId !== context.projectId
        || history.documentId !== context.documentId
        || history.sourcePath !== context.sourcePath
        || history.versionId !== version.viewingVersionId
        || !SHA256.test(String(history.sha256 || ""))
      ) {
        return blocked(
          "BROWSER_OPEN_HISTORY_REQUIRED",
          "当前历史版本缺少可验证的精确文件身份。",
        );
      }
      return succeeded(Object.freeze({
        key: `version:${context.epoch}:${context.projectId}:${context.documentId}:${history.versionId}`,
        kind: "version",
        context,
        versionId: history.versionId,
        expectedSha256: history.sha256,
      }));
    }
    if (version.viewMode !== "current") {
      return blocked("BROWSER_OPEN_SURFACE_UNSUPPORTED", "当前页面不能在浏览器中打开。");
    }
    return succeeded(Object.freeze({
      key: `working-copy:${context.epoch}:${context.projectId}:${context.documentId}`,
      kind: "working-copy",
      context,
    }));
  }

  #sameTarget(target) {
    // A successful save refreshes the managed target's byte hash without
    // navigating. Fence on the stable document identity here; the final byte
    // identity is checked separately against DocumentSession and again in
    // Desktop immediately before the external side effect.
    if (
      this.#disposed
      || !this.#projectSession.matches(stableIdentity(target.context))
    ) return false;
    const version = this.#versionSession.snapshot;
    if (target.kind === "working-copy") {
      return version.viewMode === "current" && !version.historyPreview;
    }
    const history = version.historyPreview;
    return version.viewMode === "history"
      && version.viewingVersionId === target.versionId
      && history?.versionId === target.versionId
      && history.sha256 === target.expectedSha256
      && history.projectId === target.context.projectId
      && history.documentId === target.context.documentId
      && history.sourcePath === target.context.sourcePath;
  }

  async #openTarget(target, operationId) {
    if (target.kind === "version") {
      if (!this.#sameTarget(target)) return stale(target.context);
      return this.#launch(target, operationId, {
        targetKind: "version",
        sourcePath: target.context.sourcePath,
        versionId: target.versionId,
        expectedSha256: target.expectedSha256,
      });
    }

    const checkpoint = this.#canvasPort.checkpointSource({ trigger: "save" });
    if (!checkpoint?.ok) {
      return blocked(
        "BROWSER_OPEN_EDIT_PENDING",
        checkpoint?.reason || "请完成当前文字输入，再在默认浏览器中打开。",
      );
    }
    if (!this.#sameTarget(target)) return stale(target.context);

    let launchRevision = this.#documentSession.snapshot.editRevision;
    if (checkpoint.html !== this.#documentSession.snapshot.html) {
      const enqueued = this.#documentWorkflow.enqueueEdit({
        html: checkpoint.html,
        mutation: checkpoint.pendingMutation || undefined,
        context: target.context,
      });
      if (enqueued.status !== "succeeded") return enqueued;
      launchRevision = enqueued.value.revision;
    }

    if (!this.#sameTarget(target)) return stale(target.context);
    const persisted = await this.#documentWorkflow.flush({
      throughRevision: launchRevision,
    });
    if (!this.#sameTarget(target)) return stale(target.context);
    if (persisted.status !== "succeeded") return persisted;

    const document = this.#documentSession.snapshot;
    if (
      document.editRevision !== launchRevision
      || document.lastPersistedRevision < launchRevision
      || document.hasPendingWrite
      || document.isFlushing
      || this.#documentWorkflow.hasHistoryAction
      || document.persistState !== "idle"
      || !SHA256.test(String(document.persistedSourceSha256 || ""))
      || document.persistedSourceSha256 !== document.workingHtmlSha256
    ) {
      return blocked(
        "BROWSER_OPEN_SOURCE_NOT_SETTLED",
        "当前修改尚未安全写入源 HTML，因此没有打开浏览器。请稍后重试。",
      );
    }
    if (!this.#sameTarget(target)) return stale(target.context);
    return this.#launch(target, operationId, {
      targetKind: "working-copy",
      sourcePath: target.context.exactSourcePath || target.context.sourcePath,
      expectedSha256: document.persistedSourceSha256,
    });
  }

  async #launch(target, operationId, request) {
    if (!this.#sameTarget(target)) return stale(target.context);
    try {
      const opened = await this.#filePort.openInDefaultBrowser(request);
      return succeeded(Object.freeze({ operationId, target: request, opened }));
    } catch (cause) {
      const code = errorCode(cause, "BROWSER_OPEN_REJECTED");
      const reason = this.#errorMessage(
        cause,
        "系统没有接受浏览器打开请求；当前编辑会话保持不变。",
      );
      return UNKNOWN_HOST_CODES.has(code)
        ? unknown(operationId, reason)
        : rejected(code, reason);
    }
  }
}

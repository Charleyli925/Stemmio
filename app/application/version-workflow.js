import { decodeWorkspaceResponse } from "./workspace-controller-codecs.js";
import { isBridgeRequestError } from "./bridge-client.js";
import { verifyOpenTarget } from "./verified-project-context.js";
import { planVersionActivate, planVersionPrepareReview } from "./version/review-plan.js";
import {
  copyProjectSurfaceContext,
  isProjectSurfaceContext,
} from "./project-surface-context.js";
import { sameSourceReceiptContext } from "./source-receipt.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const VERSION_ACTIVATION_PAGE_RECOVERY_REQUIRED =
  "VERSION_ACTIVATION_PAGE_RECOVERY_REQUIRED";

// Non-blocking performance-timeline marks for the accept/open critical path.
// Marks are inert outside profiling sessions and never affect control flow.
const perfMark = (name) => {
  globalThis.performance?.mark?.(name);
};

function succeeded(value) {
  return Object.freeze({ status: "succeeded", value: Object.freeze(value) });
}

function blocked(code, reason) {
  return Object.freeze({
    status: "blocked",
    code: String(code),
    reason: String(reason),
  });
}

function rejected(code, reason, extras = {}) {
  return Object.freeze({
    status: "rejected",
    code: String(code),
    reason: String(reason),
    ...extras,
  });
}

function unknown(operationId, reason) {
  return Object.freeze({
    status: "unknown",
    operationId: String(operationId),
    reason: String(reason),
  });
}

function stale(identity) {
  return Object.freeze({ status: "stale", identity: Object.freeze({ ...identity }) });
}

function errorCode(cause, fallback) {
  if (isBridgeRequestError(cause) && cause.code) return cause.code;
  if (cause && typeof cause === "object" && cause.code) return String(cause.code);
  return fallback;
}

function copyContext(context) {
  const surface = copyProjectSurfaceContext(context);
  if (surface) return surface;
  if (
    !context
    || !Number.isSafeInteger(Number(context.epoch))
    || !String(context.projectId || "")
    || !String(context.documentId || "")
    || !String(context.sourcePath || "")
  ) return null;
  const target = context.projectRootPath && context.targetKind
    ? {
      projectRootPath: String(context.projectRootPath),
      targetKind: String(context.targetKind),
      workingCopyId: context.workingCopyId ? String(context.workingCopyId) : null,
      versionId: context.versionId ? String(context.versionId) : null,
      exactSourcePath: String(context.exactSourcePath || context.sourcePath),
      sourceSha256: String(context.sourceSha256 || ""),
      sessionEpoch: Number(context.sessionEpoch ?? context.epoch),
    }
    : {};
  return Object.freeze({
    epoch: Number(context.epoch),
    projectId: String(context.projectId),
    documentId: String(context.documentId),
    sourcePath: String(context.sourcePath),
    ...target,
  });
}

function validTimestamp(value) {
  return Boolean(value) && !Number.isNaN(Date.parse(String(value)));
}

function sameRun(left, right, sameSourcePath) {
  return Boolean(
    left
    && right
    && left.projectId === right.projectId
    && left.documentId === right.documentId
    && left.requestId === right.requestId
    && left.attemptId === right.attemptId
    && sameSourcePath(left.sourcePath, right.sourcePath),
  );
}

function initialSnapshot() {
  return Object.freeze({
    navigation: Object.freeze({
      phase: "idle",
      operationId: null,
      generation: 0,
    }),
    review: Object.freeze({
      phase: "idle",
      operationId: null,
    }),
  });
}

function emptyDraftAuthority() {
  return Object.freeze({
    draftRevision: 0,
    comments: Object.freeze([]),
    changeEvents: Object.freeze([]),
    deletedCommentIds: Object.freeze([]),
    appliedOperationIds: Object.freeze([]),
  });
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}


export class VersionWorkflow {
  #creationGeneration = 0;
  #bridgeClient;
  #projectSession;
  #documentSession;
  #versionSession;
  #runSession;
  #projectWorkflow;
  #documentWorkflow;
  #commentWorkflow;
  #commentSession;
  #draftSession;
  #codecs;
  #hashPort;
  #canvasPort;
  #currentSurfacePort;
  #clock;
  #snapshot = initialSnapshot();
  #listeners = new Set();
  #eventListeners = new Set();
  #operationSequence = 0;
  #navigationGeneration = 0;
  #reviewGeneration = 0;
  #disposed = false;
  #pendingActivations = new Map();
  #filePort;
  #preservedDraftGeneration = 0;
  #exportSequence = 0;

  #activeExportOperation = null;
  #resultSequence = 0;

  constructor({
    bridgeClient,
    projectSession,
    documentSession,
    versionSession,
    runSession,
    projectWorkflow,
    documentWorkflow,
    commentWorkflow,
    commentSession,
    draftSession,
    codecs,
    ports = {},
    clock,
  } = {}) {
    if (
      !bridgeClient
      || typeof bridgeClient.versionFile !== "function"
      || typeof bridgeClient.source !== "function"
      || typeof bridgeClient.activateReadyVersion !== "function"
    ) {
      throw new TypeError("VersionWorkflow requires its Version Bridge methods.");
    }
    if (!projectSession || typeof projectSession.matches !== "function") {
      throw new TypeError("VersionWorkflow requires ProjectSession injection.");
    }
    if (!documentSession || typeof documentSession.publishAuthority !== "function") {
      throw new TypeError("VersionWorkflow requires DocumentSession injection.");
    }
    if (
      !versionSession
      || typeof versionSession.captureSnapshot !== "function"
      || typeof versionSession.restoreSnapshot !== "function"
    ) {
      throw new TypeError("VersionWorkflow requires VersionSession snapshot authority.");
    }
    if (
      !runSession
      || typeof runSession.beginOperation !== "function"
      || typeof runSession.endOperation !== "function"
    ) {
      throw new TypeError("VersionWorkflow requires RunSession injection.");
    }
    if (
      !projectWorkflow
      || typeof projectWorkflow.prepareManagedSourceTransition !== "function"
      || typeof projectWorkflow.commitManagedSourceTransition !== "function"
      || typeof projectWorkflow.drain !== "function"
      || typeof projectWorkflow.refreshWorkspace !== "function"
    ) {
      throw new TypeError("VersionWorkflow requires ProjectWorkflow publication authority.");
    }
    if (
      !documentWorkflow
      || typeof documentWorkflow.clearRecovery !== "function"
      || typeof documentWorkflow.clearAudit !== "function"
    ) {
      throw new TypeError("VersionWorkflow requires DocumentWorkflow composition.");
    }
    if (!commentWorkflow || typeof commentWorkflow.resetForProjectTransition !== "function") {
      throw new TypeError("VersionWorkflow requires CommentWorkflow composition.");
    }
    if (!commentSession || typeof commentSession.reset !== "function") {
      throw new TypeError("VersionWorkflow requires CommentSession injection.");
    }
    if (!draftSession || typeof draftSession.replaceAuthority !== "function") {
      throw new TypeError("VersionWorkflow requires DraftSession injection.");
    }
    if (!ports.hash || typeof ports.hash.sha256 !== "function") {
      throw new TypeError("VersionWorkflow requires a HashPort.");
    }
    if (!ports.canvas || typeof ports.canvas.freeze !== "function") {
      throw new TypeError("VersionWorkflow requires a CanvasAuthorityPort.");
    }
    if (typeof ports.canvas.verifyRendered !== "function") {
      throw new TypeError("VersionWorkflow CanvasAuthorityPort must verify rendered bytes.");
    }
    if (typeof ports.canvas.invalidateRenderAcks !== "function") {
      throw new TypeError("VersionWorkflow CanvasAuthorityPort must invalidate render acknowledgements.");
    }
    if (typeof ports.canvas.unlock !== "function") {
      throw new TypeError("VersionWorkflow CanvasAuthorityPort must unlock the Canvas.");
    }
    for (const method of [
      "isRecord",
      "sameSourcePath",
      "operationKey",
      "errorMessage",
      "versionsFromWorkspace",
      "draftAuthorityFromWorkspace",
      "commentsFromRecords",
      "changesFromDraftRecords",
    ]) {
      if (typeof codecs?.[method] !== "function") {
        throw new TypeError(`VersionWorkflow codec ${method} is required.`);
      }
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("VersionWorkflow requires a ClockPort.");
    }

    this.#bridgeClient = bridgeClient;
    this.#projectSession = projectSession;
    this.#documentSession = documentSession;
    this.#versionSession = versionSession;
    this.#runSession = runSession;
    this.#projectWorkflow = projectWorkflow;
    this.#documentWorkflow = documentWorkflow;
    this.#commentWorkflow = commentWorkflow;
    this.#commentSession = commentSession;
    this.#draftSession = draftSession;
    this.#codecs = codecs;
    this.#hashPort = ports.hash;
    this.#canvasPort = {
      deferCommand: ports.canvas.deferCommand || null,
      checkpointSource: ports.canvas.checkpointSource || null,
      freezeWorkingSource: ports.canvas.freezeWorkingSource || (() => ({ ok: true })),
      freeze: ports.canvas.freeze,
      verifyRendered: ports.canvas.verifyRendered,
      invalidateRenderAcks: ports.canvas.invalidateRenderAcks,
      unlock: ports.canvas.unlock,
      requestFrame: ports.canvas.requestFrame || null,
      onNavigationChange: ports.canvas.onNavigationChange || (() => {}),
    };
    this.#clock = clock;
    this.#filePort = ports.files || null;
    this.#currentSurfacePort = ports.currentSurface || null;
  }

  getSnapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("VersionWorkflow listener must be a function.");
    }
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  subscribeEvents(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("VersionWorkflow event listener must be a function.");
    }
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  dispose() {
    this.#disposed = true;
    for (const [key, pending] of this.#pendingActivations) {
      clearTimeout(pending.timer);
      this.#runSession.endOperation("activate", key);
    }
    this.#pendingActivations.clear();
    this.#navigationGeneration += 1;
    this.#reviewGeneration += 1;
    this.#canvasPort.onNavigationChange(false);
    this.#listeners.clear();
    this.#eventListeners.clear();
  }

  async prepareReviewCandidate({ run } = {}) {
    const ready = this.#readyRun(run);
    const reviewPlan = planVersionPrepareReview({
      disposed: this.#disposed,
      ready: Boolean(ready),
      baseHashOk: Boolean(ready && SHA256.test(String(ready.baseSnapshotSha256 || ""))),
    });
    if (reviewPlan.kind === "reject") {
      return reviewPlan.code === "VERSION_REVIEW_BASE_HASH_INVALID"
        ? rejected(reviewPlan.code, reviewPlan.reason)
        : blocked(reviewPlan.code, reviewPlan.reason);
    }
    const operationId = this.#nextOperationId("review");
    const generation = ++this.#reviewGeneration;
    this.#setReview("preparing", operationId);
    try {
      const payload = await this.#bridgeClient.versionFile(
        ready.sourcePath,
        ready.candidateVersionId,
      );
      if (
        this.#disposed
        || generation !== this.#reviewGeneration
        || !this.#isCurrentReadyRun(ready)
      ) return stale(this.#runIdentity(ready));

      this.#assertVersionFileIdentity(payload, ready, ready.candidateVersionId);
      const content = String(payload.content || "");
      const sha256 = String(payload.sha256 || payload.contentSha256 || "");
      const expectedSha256 = this.#candidateHash(ready, sha256);
      if (
        !content
        || !SHA256.test(sha256)
        || sha256 !== expectedSha256
        || await this.#hashPort.sha256(content) !== sha256
      ) {
        throw new Error("审阅候选与已校验版本的内容 Hash 不一致。");
      }
      if (
        this.#disposed
        || generation !== this.#reviewGeneration
        || !this.#isCurrentReadyRun(ready)
      ) return stale(this.#runIdentity(ready));

      const candidate = Object.freeze({
        operationId,
        operationKey: this.#codecs.operationKey(ready),
        projectId: ready.projectId,
        documentId: ready.documentId,
        requestId: ready.requestId,
        attemptId: ready.attemptId,
        sourcePath: ready.sourcePath,
        versionId: ready.candidateVersionId,
        baseSnapshotSha256: ready.baseSnapshotSha256,
        content,
        sha256,
        ...(ready.candidateAssessment
          ? { candidateAssessment: ready.candidateAssessment }
          : {}),
      });
      this.#emitEvent({ type: "version-review-candidate-prepared", candidate });
      return succeeded(candidate);
    } catch (cause) {
      return this.#outcomeFromCause(
        operationId,
        cause,
        "VERSION_REVIEW_CANDIDATE_REJECTED",
        "候选版本仍已安全保留，可以稍后重试。",
      );
    } finally {
      if (generation === this.#reviewGeneration) this.#setReview("idle", null);
    }
  }

  async activateReadyVersion({
    run,
    reviewLease = null,
    fromDeferred = false,
  } = {}) {
    const ready = this.#readyRun(run);
    const entryPlan = planVersionActivate({
      disposed: this.#disposed,
      ready: Boolean(ready),
    });
    if (entryPlan.kind === "reject") {
      return blocked(entryPlan.code, entryPlan.reason);
    }
    try {
      // Validate the persisted ready record before the explicit mutation. A
      // malformed late poll result must never be allowed to activate a Version
      // merely because the Bridge would later return authoritative bytes.
      this.#committedPayload(ready, ready.readyPayload);
    } catch (cause) {
      return this.#outcomeFromCause(
        this.#nextOperationId("activation-validation"),
        cause,
        "VERSION_ACTIVATION_PAYLOAD_INVALID",
        "当前候选的完成资料不完整，不能打开。",
      );
    }
    // A ready candidate from another Document must never reach Desktop. The
    // candidate may still be structurally valid for its own frozen Request,
    // but activating it against the current ProjectSession would otherwise
    // let the Bridge mutate a destination that local Sessions cannot own.
    try {
      const readyTarget = this.#readyOpenTarget(ready);
      const currentContext = this.#projectSession.context;
      if (
        !currentContext
        || readyTarget.projectId !== currentContext.projectId
        || readyTarget.documentId !== currentContext.documentId
      ) {
        if (currentContext) {
          return succeeded({
            current: false,
            context: null,
            versionId: ready.candidateVersionId,
            candidateLabel: String(
              ready.readyPayload?.candidateDisplayVersionLabel
              || ready.candidateVersionLabel
              || "",
            ),
            protocolViolation: Boolean(
              ready.readyPayload?.protocolViolation
              || ready.readyPayload?.outcome?.protocolViolation,
            ),
            committedSourcePath: ready.sourcePath,
            lastModifiedAt: String(
              ready.readyPayload?.lastModifiedAt
              || ready.readyPayload?.outcome?.completedAt
              || "",
            ),
          });
        }
        return blocked(
          "VERSION_ACTIVATION_CONTEXT_MISMATCH",
          "候选版本所属文档已不是当前编辑文档，本次采用已安全取消。",
        );
      }
    } catch (cause) {
      return this.#outcomeFromCause(
        this.#nextOperationId("activation-context-validation"),
        cause,
        "VERSION_ACTIVATION_PAYLOAD_INVALID",
        "当前候选的工作文件身份不完整，不能打开。",
      );
    }
    const hydratePlan = planVersionActivate({
      ready: true,
      projectHydrating: this.#projectWorkflow.projectHydrating,
    });
    if (hydratePlan.kind === "reject") {
      return blocked(hydratePlan.code, hydratePlan.reason);
    }
    if (!fromDeferred) {
      const deferred = this.#deferCanvasCommand(
        "external-refresh",
        () => this.activateReadyVersion({
          run: ready,
          reviewLease,
          fromDeferred: true,
        }),
        { authority: "system" },
      );
      if (deferred) return deferred;
    }
    const operationKey = this.#codecs.operationKey(ready);
    if (!this.#runSession.beginOperation("activate", operationKey)) {
      return blocked("VERSION_ACTIVATION_BUSY", "当前候选版本正在打开，请等待当前操作完成。");
    }
    const operation = this.#beginNavigation("activating", this.#projectSession.context);
    if (!operation) {
      this.#runSession.endOperation("activate", operationKey);
      return blocked("VERSION_NAVIGATION_BUSY", "当前 HTML 视图正在切换，请稍后重试。");
    }
    const pending = this.#pendingActivations.get(operationKey);
    this.#runSession.trackRun({ ...ready, adoptionPhase: pending ? "unknown" : "applying", error: undefined });
    let durableActivationOperationId = operation.operationId;
    try {
      const drained = pending ? { ok: true } : await this.#projectWorkflow.drain("history", { deadlineAt: this.#clock.now() + 15_000 });
      if (!this.#isNavigationCurrent(operation) || !this.#isCurrentReadyRun(ready)) return stale(this.#runIdentity(ready));
      if (!drained.ok) return blocked("ADOPTION_DRAFT_NOT_SAVED", drained.reason || "当前修改意见尚未保存，本次修改尚未采用。");
      const readyCandidate = this.#readyCandidate(ready);
      if (!readyCandidate) {
        throw new Error("当前候选缺少经核对的 Candidate 身份，不能重放采用操作。");
      }
      const readyTarget = this.#readyOpenTarget(ready);
      perfMark("stemmio:accept:promote-start");
      const activationRequest = pending?.request || {
        ...readyTarget,
        candidateId: readyCandidate.candidateId,
        decisionOperationId: `promote_${readyCandidate.candidateId}`,
        expectedSourceSha256: readyTarget.sourceSha256,
        sourcePath: ready.sourcePath,
        projectId: ready.projectId,
        documentId: ready.documentId,
        requestId: ready.requestId,
        attemptId: ready.attemptId,
        versionId: ready.candidateVersionId,
      };
      if (
        String(activationRequest.candidateId || "") !== readyCandidate.candidateId
        || String(activationRequest.decisionOperationId || "")
          !== `promote_${readyCandidate.candidateId}`
      ) {
        throw new Error("当前采用回执与 Candidate 身份不一致，不能重放旧操作。");
      }
      durableActivationOperationId = String(
        activationRequest.decisionOperationId || operation.operationId,
      );
      if (!pending) this.#pendingActivations.set(operationKey, { request: activationRequest, run: ready, reviewLease, timer: null, delay: 1000 });
      let activatedPayload;
      try {
        activatedPayload = await this.#bridgeClient.activateReadyVersion(activationRequest);
      } catch (cause) {
        if (!activationRequest.decisionOperationId || !isBridgeRequestError(cause) || cause.outcome !== "unknown") throw cause;
        if (!this.#isNavigationCurrent(operation) || !this.#isCurrentReadyRun(ready)) return stale(this.#runIdentity(ready));
        activatedPayload = await this.#bridgeClient.activateReadyVersion(activationRequest);
      }
      const activatedOpenTarget = this.#activatedOpenTarget(ready, activatedPayload);
      perfMark("stemmio:accept:promote-end");
      if (!this.#isNavigationCurrent(operation) || !this.#isCurrentReadyRun(ready)) {
        this.#clearPendingActivation(operationKey);
        return stale(this.#runIdentity(ready));
      }
      const opened = await this.#openCommittedVersion({
        run: ready,
        payload: {
          ...ready.readyPayload,
          ...activatedPayload,
          openTarget: activatedPayload.openTarget || null,
          completion: ready.readyPayload.completion,
          outcome: ready.readyPayload.outcome,
          version: activatedPayload.version || ready.readyPayload.version,
          openTarget: activatedOpenTarget,
        },
        reviewLease,
        operation,
        activationOperationId: durableActivationOperationId,
      });
      if (opened.status !== "succeeded") {
        if (opened.code === "VERSION_ACTIVATION_SUPERSEDED") {
          this.#clearPendingActivation(operationKey);
          if (this.#isCurrentReadyRun(ready)) {
            this.#runSession.setActiveRun({
              ...this.#runSession.activeRun,
              status: "complete",
              completionObserved: true,
              adoptionPhase: undefined,
              error: undefined,
            });
            this.#runSession.removeRun(ready, { clearActive: false });
            const handoff = this.#runSession.activeHandoff;
            if (handoff?.requestId === ready.requestId
              && handoff.attemptId === ready.attemptId
              && this.#codecs.sameSourcePath(handoff.sourcePath, ready.sourcePath)) {
              this.#runSession.clearActiveHandoff();
            }
          }
        }
        if (opened.code === VERSION_ACTIVATION_PAGE_RECOVERY_REQUIRED) {
          this.#clearPendingActivation(operationKey);
          if (this.#isCurrentReadyRun(ready)) {
            const recovery = opened.recovery || {};
            const completed = this.#settleActivatedRun(
              ready,
              {
                committedSourcePath: String(
                  recovery.committedSourcePath || ready.sourcePath,
                ),
                candidateLabel: String(
                  recovery.candidateLabel || ready.candidateVersionLabel,
                ),
                protocolViolation: Boolean(recovery.protocolViolation),
              },
              {
                pageRecoveryRequired: true,
                pageRecoveryReason: opened.reason,
              },
            );
            this.#emitEvent({
              type: "version-activation-recovery-required",
              run: completed,
              context: recovery.context || this.#projectSession.context,
              operationKey: this.#codecs.operationKey(ready),
              candidateLabel: completed.candidateVersionLabel,
              reason: opened.reason,
            });
          }
        }
        return opened;
      }

      this.#clearPendingActivation(operationKey);
      const completed = this.#settleActivatedRun(ready, opened.value);
      const value = {
        ...opened.value,
        completedRun: completed,
      };
      this.#emitEvent({ type: "version-activated", ...value });
      return succeeded(value);
    } catch (cause) {
      if (
        (isBridgeRequestError(cause) && cause.outcome === "unknown")
        || cause?.projectOutcome === "unknown"
      ) {
        return unknown(durableActivationOperationId, "采用结果待确认，正在自动核对。请勿重复采用或结束本轮。");
      }
      this.#clearPendingActivation(operationKey);
      const reason = ["SOURCE_HASH_CONFLICT", "CANDIDATE_SOURCE_CHANGED", "CANDIDATE_SOURCE_CONFLICT"].includes(errorCode(cause, ""))
        ? "页面已发生变化，本次修改尚未应用。"
        : this.#codecs.errorMessage(cause, "最新版暂时无法打开。");
      if (this.#runMatches(this.#runSession.activeRun, ready)) {
        this.#runSession.trackRun({
          ...ready,
          status: "ready-to-open",
          error: reason,
        });
      }
      return this.#outcomeFromCause(
        durableActivationOperationId,
        cause,
        "VERSION_ACTIVATION_REJECTED",
        reason,
      );
    } finally {
      if (this.#pendingActivations.has(operationKey)) {
        this.#runSession.trackRun({ ...ready, adoptionPhase: "unknown", error: undefined });
        this.#scheduleActivationReconciliation(operationKey);
      } else {
        this.#runSession.endOperation("activate", operationKey);
        if (this.#isCurrentReadyRun(ready)) this.#runSession.trackRun({ ...this.#runSession.activeRun, adoptionPhase: undefined });
      }
      this.#finishNavigation(operation);
    }
  }

  #clearPendingActivation(key) {
    clearTimeout(this.#pendingActivations.get(key)?.timer);
    this.#pendingActivations.delete(key);
  }

  #scheduleActivationReconciliation(key) {
    const pending = this.#pendingActivations.get(key);
    if (!pending || !pending.request.decisionOperationId || pending.timer || this.#disposed) return;
    pending.timer = setTimeout(async () => {
      pending.timer = null;
      if (this.#disposed || this.#pendingActivations.get(key) !== pending) return;
      if (this.#isCurrentReadyRun(pending.run)) {
        this.#runSession.endOperation("activate", key);
        await this.activateReadyVersion({ run: pending.run, reviewLease: pending.reviewLease });
      }
      pending.delay = Math.min(30_000, pending.delay * 2);
      this.#scheduleActivationReconciliation(key);
    }, pending.delay);
    pending.timer.unref?.();
  }

  async openCommittedVersion({
    run,
    payload,
    reviewLease = null,
    fromDeferred = false,
  } = {}) {
    if (this.#disposed) {
      return blocked("VERSION_WORKFLOW_DISPOSED", "版本工作流已经停止。");
    }
    if (!run || !this.#codecs.isRecord(payload)) {
      return blocked("VERSION_OPEN_PRECONDITION", "完成结果缺少可校验的版本资料。");
    }
    if (!fromDeferred) {
      const deferred = this.#deferCanvasCommand(
        "external-refresh",
        () => this.openCommittedVersion({
          run,
          payload,
          reviewLease,
          fromDeferred: true,
        }),
        { authority: "system" },
      );
      if (deferred) return deferred;
    }
    const operation = this.#beginNavigation("opening", this.#projectSession.context);
    if (!operation) {
      return blocked("VERSION_NAVIGATION_BUSY", "当前 HTML 视图正在切换，请稍后重试。");
    }
    try {
      return await this.#openCommittedVersion({
        run,
        payload,
        reviewLease,
        operation,
      });
    } catch (cause) {
      return this.#outcomeFromCause(
        operation.operationId,
        cause,
        "VERSION_OPEN_REJECTED",
        "已生成的版本暂时无法安全打开。",
      );
    } finally {
      this.#finishNavigation(operation);
    }
  }

  /**
   * Finish the post-Canvas part of an adoption whose Version and Working Copy
   * were already committed.  WorkspaceController calls this before the
   * RunWorkflow one-shot gate clears `pageRecoveryRequired`; callers pass the
   * flagged Run so a second call cannot pass after that gate settles.
   */
  completePageRecovery({ run } = {}) {
    if (this.#disposed) {
      return blocked("VERSION_WORKFLOW_DISPOSED", "版本工作流已经停止。");
    }
    if (!run?.requestId || run.pageRecoveryRequired !== true) {
      return blocked(
        "VERSION_PAGE_RECOVERY_UNAVAILABLE",
        "当前没有等待版本收尾的页面恢复结果。",
      );
    }
    const active = this.#runSession.activeRun;
    if (
      !active
      || !this.#runMatches(active, run)
      || (active.sourceWorkingCopyId && run.sourceWorkingCopyId
        && active.sourceWorkingCopyId !== run.sourceWorkingCopyId)
    ) {
      return stale(this.#runIdentity(run));
    }
    if (active.pageRecoveryRequired !== true) {
      return blocked(
        "VERSION_PAGE_RECOVERY_NOT_PENDING",
        "当前运行已经完成页面恢复收尾。",
      );
    }
    const context = copyContext(this.#projectSession.context);
    if (
      !context
      || !this.#projectSession.matches(context)
      || !this.#codecs.sameSourcePath(active.sourcePath, context.sourcePath)
      || active.projectId !== context.projectId
      || active.documentId !== context.documentId
    ) {
      return stale(context || this.#runIdentity(active));
    }

    const document = this.#documentSession.snapshot;
    const canvas = document.canvasAuthority;
    const receipt = document.sourceReceipt;
    const expectedSourceSha256 = this.#candidateHash(run, "");
    if (
      !SHA256.test(expectedSourceSha256)
      || canvas?.status !== "verified"
      || canvas.generation !== document.canvasGeneration
      || canvas.renderedSha256 !== expectedSourceSha256
      || document.workingHtmlSha256 !== expectedSourceSha256
      || document.persistedSourceSha256 !== expectedSourceSha256
      || !receipt
      || receipt.canvasGeneration !== document.canvasGeneration
      || receipt.sourceSha256 !== expectedSourceSha256
      || !sameSourceReceiptContext(receipt, { context })
    ) {
      return blocked(
        "VERSION_PAGE_RECOVERY_NOT_VERIFIED",
        "当前页面还没有完成采用后源码核验。",
      );
    }

    const readyPayload = this.#codecs.isRecord(run.readyPayload)
      ? run.readyPayload
      : {};
    const outcome = this.#codecs.isRecord(readyPayload.outcome)
      ? readyPayload.outcome
      : {};
    const protocolViolation = Boolean(
      run.status === "error"
      || readyPayload.protocolViolation
      || outcome.protocolViolation,
    );
    return this.#finalizeCommittedVersion({
      context,
      committedSourcePath: context.sourcePath,
      versionId: String(
        run.candidateVersionId
        || readyPayload.versionId
        || readyPayload.version?.versionId
        || "",
      ),
      candidateLabel: String(
        run.candidateVersionLabel
        || readyPayload.candidateDisplayVersionLabel
        || "",
      ),
      protocolViolation,
      aiCompletedAt: String(
        readyPayload.completion?.completedAt
        || outcome.completedAt
        || "",
      ),
      lastModifiedAt: "",
    });
  }

  async viewHistory({
    version,
    context = this.#projectSession.context,
    deadlineAt = this.#clock.now() + 15_000,
    fromDeferred = false,
    switchPrepared = false,
  } = {}) {
    if (this.#disposed) {
      return blocked("VERSION_WORKFLOW_DISPOSED", "版本工作流已经停止。");
    }
    const current = copyContext(context);
    if (!current || !this.#acceptsSurfaceContext(current)) {
      return stale(current || {});
    }
    if (!version?.id) {
      return blocked("VERSION_HISTORY_PRECONDITION", "当前历史版本缺少可验证的版本 ID。");
    }
    const ownsCurrentRuntime = this.#projectSession.matches(current);
    if (ownsCurrentRuntime && (this.#projectWorkflow.projectHydrating || this.#projectWorkflow.projectLoadError)) {
      return blocked("VERSION_HISTORY_PROJECT_UNAVAILABLE", "项目状态尚未准备完成，不能切换历史视图。");
    }
    if (this.#runLockedForContext(current)) {
      return blocked("VERSION_HISTORY_RUN_LOCKED", "当前 AI 处理尚未完成，不能切换历史视图。");
    }
    if (!fromDeferred && !switchPrepared) {
      const deferred = this.#deferCanvasCommand(
        "project-switch",
        () => this.viewHistory({ version, context: current, deadlineAt, fromDeferred: true, switchPrepared }),
      );
      if (deferred) return deferred;
    }
    const operation = this.#beginNavigation("history", current);
    if (!operation) {
      return blocked("VERSION_NAVIGATION_BUSY", "当前 HTML 视图正在切换，请稍后重试。");
    }
    try {
      if (!switchPrepared && this.#versionSession.snapshot.viewMode === "current") {
        const frozen = this.#freezeCurrentCanvas(
          "当前编辑画布尚未完成安全收口，无法打开历史版本。",
        );
        if (!frozen.ok) return blocked("VERSION_HISTORY_CANVAS_FENCE", frozen.reason);
        const drained = await this.#projectWorkflow.drain("history", { deadlineAt });
        if (!this.#isNavigationCurrent(operation)) return stale(current);
        if (!drained.ok) throw new Error(drained.reason || "当前编辑没有完成安全收口。");
      }
      const payload = await this.#bridgeClient.versionFile(current.sourcePath, String(version.id));
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      this.#assertVersionFileIdentity(payload, current, String(version.id));
      const content = String(payload.content || "");
      const sha256 = String(payload.sha256 || payload.contentSha256 || "");
      if (
        (version.contentSha256 && sha256 !== String(version.contentSha256))
        || !SHA256.test(sha256)
        || await this.#hashPort.sha256(content) !== sha256
      ) {
        throw new Error("历史文件内容与声明 Hash 不一致，已拒绝打开。");
      }
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      this.#versionSession.enterHistory(String(version.id), {
        projectId: current.projectId, documentId: current.documentId,
        sourcePath: current.sourcePath, versionId: String(version.id), content, sha256,
        context: current,
      });
      const value = { context: current, versionId: String(version.id), content, sha256 };
      this.#emitEvent({ type: "version-history-viewed", ...value });
      return succeeded(value);
    } catch (cause) {
      return rejected(
        errorCode(cause, "VERSION_HISTORY_REJECTED"),
        this.#codecs.errorMessage(
          cause,
          "历史版本没有打开；当前工作内容仍保留。",
        ),
      );
    } finally {
      this.#finishNavigation(operation);
    }
  }

  async returnToCurrent({
    context = this.#projectSession.context,
    currentSurfaceCommitScope = null,
  } = {}) {
    if (this.#disposed) {
      return blocked("VERSION_WORKFLOW_DISPOSED", "版本工作流已经停止。");
    }
    const current = copyContext(context);
    if (!current || !this.#projectSession.matches(current)) {
      return stale(current || {});
    }
    if (this.#snapshot.navigation.phase !== "idle") {
      return blocked("VERSION_NAVIGATION_BUSY", "当前 HTML 视图正在切换，请稍后重试。");
    }
    const creation = this.#snapshot.creation;
    if (creation?.context.projectId === current.projectId && creation.context.documentId === current.documentId) {
      if (creation.phase === "unknown") return blocked("HISTORY_CREATION_UNKNOWN", "创建结果暂时未知，请先查询同一操作；仍可切换项目或关闭标签。");
      if (["created", "open-failed"].includes(creation.phase)) {
        const result = creation.result;
        const liveContext = this.#projectSession.context;
        const currentAlreadyOwnsCreatedVersion = Boolean(
          result?.status === "created"
          && liveContext?.workingCopyId === result.workingCopyId
          && liveContext.versionId === result.versionId
          && this.#versionSession.snapshot.currentBasedOnVersionId === result.versionId
          && this.#documentSession.persistedSourceSha256 === result.contentSha256
        );
        if (currentAlreadyOwnsCreatedVersion) {
          const priorView = this.#versionSession.captureView();
          const generation = ++this.#creationGeneration;
          this.#versionSession.returnCurrent();
          try {
            await new Promise((resolve) => {
              if (typeof this.#canvasPort.requestFrame !== "function") {
                resolve();
                return;
              }
              this.#canvasPort.requestFrame(() => this.#canvasPort.requestFrame(resolve));
            });
            await this.#canvasPort.verifyRendered(
              this.#documentSession.html,
              this.#documentSession.persistedSourceSha256,
              current,
            );
            if (!this.#projectSession.matches(current)) {
              this.#versionSession.restoreView(priorView);
              return stale(current);
            }
            try {
              await this.#bridgeClient.confirmHistoryCreationOpened({
                target: liveContext,
                operationId: creation.operationId,
              });
            } catch { /* The exact current Canvas is already usable; retry acknowledgement on restart. */ }
            this.#setHistoryCreation({
              phase: "opened",
              operationId: creation.operationId,
              context: current,
              result,
            }, generation);
            const value = {
              context: current,
              content: this.#documentSession.html,
              sha256: this.#documentSession.snapshot.workingHtmlSha256,
            };
            this.#emitEvent({ type: "version-current-returned", ...value });
            void this.#documentWorkflow.observeExternalSourceChange({ sourcePath: current.sourcePath });
            return succeeded(value);
          } catch {
            this.#versionSession.restoreView(priorView);
          }
        }
        return this.openCreatedHistoryVersion({
          operationId: creation.operationId,
          context: current,
          currentSurfaceCommitScope,
        });
      }
    }
    // Leaving a read-only projection must remain possible even when a disk
    // check fails. Observation reports conflicts through DocumentWorkflow and
    // never replaces the protected current source with disk bytes.
    this.#versionSession.returnCurrent();
    const value = { context: current, content: this.#documentSession.html,
      sha256: this.#documentSession.snapshot.workingHtmlSha256 };
    this.#emitEvent({ type: "version-current-returned", ...value });
    void this.#documentWorkflow.observeExternalSourceChange({ sourcePath: current.sourcePath });
    return succeeded(value);
  }

  #setHistoryCreation(value, generation) {
    if (generation !== this.#creationGeneration) return;
    this.#snapshot = Object.freeze({ ...this.#snapshot, creation: Object.freeze(value) });
    this.#publishSnapshot();
  }

  #sameCurrentDocument(context) {
    const current = this.#projectSession.context;
    return Boolean(!this.#disposed && context && current
      && context.epoch === current.epoch && context.projectId === current.projectId
      && context.documentId === current.documentId && this.#codecs.sameSourcePath(context.sourcePath, current.sourcePath)
      && context.workingCopyId === current.workingCopyId);
  }

  #setDraftVersion(value) {
    if (!this.#sameCurrentDocument(value.context)) return;
    this.#snapshot = Object.freeze({ ...this.#snapshot, draftVersion: Object.freeze({ ...value, sequence: ++this.#resultSequence }) });
    this.#publishSnapshot();
  }

  #validateCurrentVersion(payload, context, operationId, expectedSourceSha256, recoveryId) {
    if (!isRecord(payload) || payload.projectId !== context.projectId
      || payload.documentId !== context.documentId || payload.operationId !== operationId
      || !["created", "unchanged", "not-created"].includes(payload.status)) {
      throw new Error("版本保存回执身份不一致。");
    }
    if (payload.status !== "not-created" && (
      !Number.isSafeInteger(payload.versionOrdinal) || payload.versionOrdinal < 1
      || payload.versionId !== `ver_${String(payload.versionOrdinal).padStart(4, "0")}`
      || payload.workingCopyId !== context.workingCopyId
      || !this.#codecs.sameSourcePath(payload.sourcePath, context.sourcePath)
      || !SHA256.test(String(payload.sourceSha256 || ""))
      || (!recoveryId && payload.sourceSha256 !== expectedSourceSha256)
      || (recoveryId && payload.recoveryId !== recoveryId)
    )) throw new Error("版本保存回执内容不一致。");
    return Object.freeze({ ...payload });
  }

  saveCurrentVersion(input = {}) {
    return this.#runCurrentVersionCommand(input);
  }

  retryCurrentVersion(input = {}) {
    const pending = this.#snapshot.draftVersion;
    if (!pending || !this.#sameCurrentDocument(pending.context)) {
      return Promise.resolve(blocked("VERSION_OPERATION_MISSING", "没有待确认的版本操作。"));
    }
    return this.#runCurrentVersionCommand({ ...input, ...pending,
      queryOnly: pending.phase === "unknown" || pending.phase === "refresh-pending" });
  }

  restorePreservedDraft({ recoveryId, ...input } = {}) {
    return this.#runCurrentVersionCommand({ ...input, recoveryId });
  }

  async #runCurrentVersionCommand({ operationId, context, recoveryId = null,
    expectedSourceSha256 = null, queryOnly = false } = {}) {
    let current = copyContext(context || this.#projectSession.context);
    if (!this.#sameCurrentDocument(current)) return stale(current || {});
    if (this.#versionSession.snapshot.historyPreview && !recoveryId && !queryOnly) {
      return blocked("CURRENT_DRAFT_REQUIRED", "请返回当前稿后保存版本。");
    }
    if (this.#runSession.activeLocked) return blocked("VERSION_RUN_LOCKED", "请先完成当前 AI 任务或候选的处理。");
    const pending = this.#snapshot.draftVersion;
    if (pending?.phase === "unknown" && this.#sameCurrentDocument(pending.context)
      && operationId !== pending.operationId) {
      return blocked("VERSION_RESULT_UNKNOWN", "正在确认上一次版本保存结果。");
    }
    operationId ||= this.#nextOperationId(recoveryId ? "restore-draft" : "save-version");
    const operation = this.#beginNavigation("creating", current);
    if (!operation) return blocked("VERSION_NAVIGATION_BUSY", "版本操作正在进行。");
    const setState = (phase, extra = {}) => this.#setDraftVersion({
      phase, operationId, context: current, recoveryId, expectedSourceSha256, ...extra,
    });
    const query = () => (recoveryId
      ? this.#bridgeClient.queryPreservedDraftRestore({ target: current, operationId })
      : this.#bridgeClient.queryCurrentVersionCreation({ target: current, operationId }));
    let attempted = queryOnly;
    let result = null;
    setState("saving");
    try {
      if (!queryOnly) {
        const drained = await this.#projectWorkflow.drain("history", { deadlineAt: this.#clock.now() + 15_000 });
        if (!this.#isNavigationActive(operation) || !this.#sameCurrentDocument(current)) {
          this.#finishNavigation(operation);
          return stale(current);
        }
        if (!drained.ok) throw new Error(drained.reason || "当前修改尚未保存。");
        current = copyContext(this.#projectSession.context);
        const persistedHash = this.#documentSession.persistedSourceSha256;
        const actualHash = await this.#hashPort.sha256(this.#documentSession.html);
        if (!this.#sameCurrentDocument(current)) {
          this.#finishNavigation(operation);
          return stale(current);
        }
        if (persistedHash !== actualHash || (expectedSourceSha256 && expectedSourceSha256 !== actualHash)) {
          throw new Error("当前稿已发生变化，请保存当前稿的新版本。已导出的文件保持原样。");
        }
        expectedSourceSha256 ||= actualHash;
        attempted = true;
        const input = { target: current, operationId, expectedSourceSha256 };
        result = this.#validateCurrentVersion(await (recoveryId
          ? this.#bridgeClient.restorePreservedDraft({ ...input, recoveryId })
          : this.#bridgeClient.createVersionFromCurrent(input)), current, operationId, expectedSourceSha256, recoveryId);
      } else {
        result = this.#validateCurrentVersion(await query(), current, operationId, expectedSourceSha256, recoveryId);
      }
    } catch (cause) {
      if (attempted) {
        try {
          result = this.#validateCurrentVersion(await query(), current, operationId, expectedSourceSha256, recoveryId);
        } catch {
          setState("unknown", { reason: "暂时无法确认版本保存结果，请查询同一操作。" });
          this.#finishNavigation(operation);
          return unknown(operationId, "暂时无法确认版本保存结果。");
        }
      }
      if (!result || result.status === "not-created") {
        const reason = this.#codecs.errorMessage(cause, "版本尚未保存，当前稿保留。");
        setState("failed", { reason });
        this.#finishNavigation(operation);
        return rejected(errorCode(cause, "CURRENT_VERSION_NOT_CREATED"), reason);
      }
    }
    try {
      if (!this.#isNavigationActive(operation) || !this.#sameCurrentDocument(current)) return stale(current);
      if (result.status === "not-created") {
        setState("failed", { reason: "版本尚未保存，可以重试。" });
        return rejected("CURRENT_VERSION_NOT_CREATED", "版本尚未保存，可以重试。");
      }
      // Refresh the existing owners. A local checkpoint preserves source bytes,
      // so the ordinary metadata refresh does not replace the editing Canvas.
      const refreshed = await this.#projectWorkflow.refreshWorkspace({ sourcePath: current.sourcePath,
        epoch: current.epoch, fromDeferred: true });
      if (!this.#sameCurrentDocument(current)) return stale(current);
      current = copyContext(this.#projectSession.context);
      if (refreshed.status !== "succeeded") {
        setState("refresh-pending", { result, reason: "版本已保存，正在等待项目状态更新。" });
        return succeeded(result);
      }
      if (recoveryId) {
        this.#versionSession.returnCurrent();
        await this.#canvasPort.verifyRendered(this.#documentSession.html,
          this.#documentSession.persistedSourceSha256, current);
      }
      setState(result.status === "unchanged" ? "unchanged" : "saved", { result });
      this.#projectWorkflow.scheduleProjectListRefreshAfterSettlement(current);
      return succeeded(result);
    } catch (cause) {
      setState("refresh-pending", { result, reason: this.#codecs.errorMessage(cause, "版本已保存，项目状态尚未更新。") });
      return succeeded(result);
    } finally {
      this.#finishNavigation(operation);
    }
  }

  async loadPreservedDrafts() {
    const current = copyContext(this.#projectSession.context);
    if (!current) return blocked("PROJECT_CONTEXT_REQUIRED", "请先打开项目。");
    const generation = ++this.#preservedDraftGeneration;
    try {
      const payload = await this.#bridgeClient.listPreservedDrafts({ projectId: current.projectId });
      if (!this.#sameCurrentDocument(current) || generation !== this.#preservedDraftGeneration) return stale(current);
      if (payload.projectId !== current.projectId) throw new Error("保留稿件的项目身份不一致。");
      const entries = payload.drafts;
      if (!Array.isArray(entries) || entries.some((entry) => !isRecord(entry)
        || !/^[A-Za-z0-9_-]{8,160}$/.test(String(entry.recoveryId || ""))
        || !SHA256.test(String(entry.sourceSha256 || "")) || !validTimestamp(entry.createdAt))) {
        throw new Error("保留稿件的记录不完整。");
      }
      return succeeded({ context: current, entries });
    } catch (cause) {
      return rejected("PRESERVED_DRAFTS_UNAVAILABLE", this.#codecs.errorMessage(cause, "暂时无法读取保留的稿件。"));
    }
  }

  async exportHtml({ suggestedName, saveVersion = false } = {}) {
    if (!this.#filePort?.exportHtmlCopy) return blocked("EXPORT_UNAVAILABLE", "导出功能暂不可用。");
    if (this.#activeExportOperation !== null) {
      return blocked("EXPORT_BUSY", "导出正在进行。");
    }
    const history = this.#versionSession.snapshot.historyPreview;
    const locator = this.#projectSession.locator;
    let context = history
      ? copyContext(history.context)
      : copyContext(this.#projectSession.context);
    const localDocument = !history && !context && !locator.sourcePath && locator.epoch > 0
      && Boolean(this.#documentSession.html);
    if (!context && !localDocument) return blocked("PROJECT_CONTEXT_REQUIRED", "请先打开项目。");
    if (history && (!context || !this.#acceptsSurfaceContext(context)
      || history.projectId !== context.projectId || history.documentId !== context.documentId
      || !this.#codecs.sameSourcePath(history.sourcePath, context.sourcePath))) {
      return stale(context || locator);
    }
    const isCurrentSurface = () => history
      ? !this.#disposed && this.#versionSession.snapshot.historyPreview === history
      : context
        ? this.#sameCurrentDocument(context)
        : !this.#disposed && this.#projectSession.epoch === locator.epoch && !this.#projectSession.sourcePath;
    if (!history) {
      const checkpoint = this.#canvasPort.checkpointSource?.();
      if (checkpoint && !checkpoint.ok) return blocked("EXPORT_EDIT_PENDING", checkpoint.reason || "请先完成当前文字输入。");
      if (!isCurrentSurface()) return stale(context || locator);
      context = copyContext(this.#projectSession.context);
    }
    const html = history ? history.content : this.#documentSession.html;
    const revision = this.#documentSession.editRevision;
    const sequence = ++this.#exportSequence;
    this.#activeExportOperation = sequence;
    const setState = (value) => {
      if (!isCurrentSurface() || sequence !== this.#exportSequence) return;
      this.#snapshot = Object.freeze({ ...this.#snapshot, export: Object.freeze({ context, ...value, sequence: ++this.#resultSequence }) });
      this.#publishSnapshot();
    };
    setState({ phase: "exporting" });
    let exported;
    try {
      const hash = await this.#hashPort.sha256(html);
      if (!isCurrentSurface() || sequence !== this.#exportSequence) return stale(context || locator);
      const ordinal = history ? this.#versionSession.snapshot.versions.find((version) => version.id === history.versionId)?.ordinal : null;
      const name = history ? `${String(suggestedName || "项目").replace(/\.html?$/iu, "")}-V${ordinal}.html` : suggestedName;
      exported = await this.#filePort.exportHtmlCopy({ html, sourcePath: context?.sourcePath || null, suggestedName: name });
      if (!exported) {
        setState({ phase: "cancelled" });
        return succeeded({ cancelled: true });
      }
      if (exported.kind === "download-started") {
        if (!isCurrentSurface()) return stale(context || locator);
        setState({ phase: "download-started" });
        return succeeded({ downloadStarted: true });
      }
      if (!context) throw new Error("浏览器下载未提供可验证的文件保存回执。");
      if (exported.sha256 !== hash || !String(exported.path || "")) throw new Error("导出文件未通过内容校验。");
      if (!isCurrentSurface()) return stale(context);
      if (!history) await this.#documentWorkflow.recordVerifiedExport({ context, html, revision, exported });
      if (saveVersion && !history) {
        setState({ phase: "saving-version", path: exported.path });
        const operationId = this.#nextOperationId("export-version");
        const saved = await this.saveCurrentVersion({ context, operationId, expectedSourceSha256: hash });
        if (saved.status !== "succeeded") {
          const hasOperation = this.#snapshot.draftVersion?.operationId === operationId;
          setState({ phase: "version-pending", path: exported.path,
            ...(hasOperation ? { versionOperationId: operationId } : {}),
            reason: saved.status === "unknown" ? "HTML 已导出，版本保存结果待确认。"
              : `HTML 已导出，版本尚未保存。${saved.reason || ""}` });
          return succeeded({ exported, version: saved });
        }
      }
      setState({ phase: "exported", path: exported.path });
      return succeeded({ exported });
    } catch (cause) {
      const reason = this.#codecs.errorMessage(cause, "HTML 导出失败，请选择其他位置重试。");
      setState({ phase: "failed", reason, ...(exported?.path ? { path: exported.path } : {}) });
      return rejected("EXPORT_FAILED", reason);
    } finally {
      if (this.#activeExportOperation === sequence) this.#activeExportOperation = null;
      if (sequence === this.#exportSequence && !isCurrentSurface()) {
        const { export: _completedExport, ...snapshot } = this.#snapshot;
        this.#snapshot = Object.freeze(snapshot);
        this.#publishSnapshot();
      }
    }
  }

  #validateHistoryCreation(payload, context, operationId, versionId = null, snapshotSha256 = null) {
    if (!isRecord(payload) || payload.operationId !== operationId
      || payload.projectId !== context.projectId || payload.documentId !== context.documentId
      || !["created", "not-created"].includes(payload.status)) {
      throw new Error("新版本操作回执身份不一致。");
    }
    if (payload.status === "created" && (
      !Number.isSafeInteger(payload.versionOrdinal) || payload.versionOrdinal < 2
      || payload.versionId !== `ver_${String(payload.versionOrdinal).padStart(4, "0")}`
      || !String(payload.sourcePath || "") || !SHA256.test(String(payload.contentSha256 || ""))
      || !/^work_[A-Za-z0-9_-]+$/.test(String(payload.workingCopyId || ""))
      || payload.previousVersionId !== `ver_${String(payload.versionOrdinal - 1).padStart(4, "0")}`
      || !/^ver_\d{4,}$/.test(String(payload.basedOnVersionId || ""))
      || !["pending", "opened", "superseded"].includes(payload.recoveryState)
      || (payload.openedAt !== null && (typeof payload.openedAt !== "string" || Number.isNaN(Date.parse(payload.openedAt))))
      || (versionId && payload.basedOnVersionId !== versionId)
      || (snapshotSha256 && payload.contentSha256 !== snapshotSha256)
    )) throw new Error("新版本操作回执内容不一致。");
    return Object.freeze({ ...payload });
  }

  async createVersionFromHistory({ operationId, context = this.#projectSession.context } = {}) {
    const current = copyContext(context);
    if (this.#disposed) return blocked("VERSION_WORKFLOW_DISPOSED", "版本工作流已经停止。");
    if (!current || !this.#acceptsSurfaceContext(current)) return stale(current || {});
    const pending = this.#snapshot.creation;
    if (pending?.context.projectId === current.projectId && pending.context.documentId === current.documentId
      && !["opened", "superseded", "not-created"].includes(pending.phase)) {
      return blocked("HISTORY_CREATION_PENDING", "请先查询或打开上一次创建操作的结果。");
    }
    const preview = this.#versionSession.snapshot.historyPreview;
    if (!preview || preview.projectId !== current.projectId || preview.documentId !== current.documentId
      || preview.sourcePath !== current.sourcePath || !/^[A-Za-z0-9_-]{8,160}$/.test(String(operationId || ""))) {
      return blocked("HISTORY_CREATION_PRECONDITION", "请先打开要作为来源的历史版本。");
    }
    if (this.#runLockedForContext(current)) return blocked("HISTORY_CREATION_RUN_LOCKED", "请先完成当前 AI 任务或候选的处理。");
    const operation = this.#beginNavigation("creating", current);
    if (!operation) return blocked("VERSION_NAVIGATION_BUSY", "版本操作正在进行。");
    const creationGeneration = ++this.#creationGeneration;
    this.#setHistoryCreation({ phase: "creating", operationId, context: current }, creationGeneration);
    let attempted = false;
    try {
      const drained = isProjectSurfaceContext(current)
        ? { ok: true }
        : await this.#projectWorkflow.drain("history", { deadlineAt: this.#clock.now() + 15_000 });
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      if (!drained.ok) return blocked("HISTORY_CREATION_DRAIN", drained.reason || "当前修改尚未保存。");
      attempted = true;
      const payload = await this.#bridgeClient.createVersionFromHistory({
        target: current, operationId, versionId: preview.versionId,
        expectedSourceSha256: isProjectSurfaceContext(current)
          ? current.sourceSha256
          : this.#documentSession.persistedSourceSha256,
        expectedSnapshotSha256: preview.sha256,
      });
      const result = this.#validateHistoryCreation(payload, current, operationId, preview.versionId, preview.sha256);
      if (result.status !== "created") throw new Error("创建操作没有返回已创建版本。");
      this.#setHistoryCreation({ phase: "created", operationId, context: current, result }, creationGeneration);
      return succeeded(result);
    } catch (cause) {
      if (attempted) {
        try {
          const result = this.#validateHistoryCreation(await this.#bridgeClient.queryHistoryCreation({ target: current, operationId }),
            current, operationId, preview.versionId, preview.sha256);
          this.#setHistoryCreation({ phase: this.#historyCreationPhase(result), operationId, context: current, result }, creationGeneration);
          if (result.status === "created") return succeeded(result);
          return rejected(errorCode(cause, "HISTORY_CREATION_NOT_CREATED"), this.#codecs.errorMessage(cause, "尚未创建新版本，可以重试。"));
        } catch {
          this.#setHistoryCreation({ phase: "unknown", operationId, context: current }, creationGeneration);
          return unknown(operationId, "创建结果暂时未知，请查询此操作的结果，不要重新创建。");
        }
      }
      this.#setHistoryCreation({ phase: "not-created", operationId, context: current }, creationGeneration);
      return rejected(errorCode(cause, "HISTORY_CREATION_NOT_CREATED"), this.#codecs.errorMessage(cause, "尚未创建新版本。"));
    } finally {
      if (this.#snapshot.creation?.phase === "creating") this.#setHistoryCreation({ phase: "not-created", operationId, context: current }, creationGeneration);
      this.#finishNavigation(operation);
    }
  }

  #historyCreationPhase(result) {
    if (result.status !== "created") return "not-created";
    if (result.recoveryState === "superseded") return "superseded";
    return result.openedAt ? "opened" : "created";
  }

  async queryHistoryCreation({ operationId, context = this.#projectSession.context } = {}) {
    const current = copyContext(context);
    if (!current || this.#disposed) return blocked("HISTORY_CREATION_CONTEXT", "项目身份不可用。");
    const creationGeneration = ++this.#creationGeneration;
    try {
      const result = this.#validateHistoryCreation(await this.#bridgeClient.queryHistoryCreation({ target: current, operationId }), current, operationId);
      this.#setHistoryCreation({ phase: this.#historyCreationPhase(result), operationId, context: current, result }, creationGeneration);
      return succeeded(result);
    } catch {
      this.#setHistoryCreation({ phase: "unknown", operationId, context: current }, creationGeneration);
      return unknown(operationId, "暂时无法确认创建结果，请稍后查询同一操作。");
    }
  }

  async restoreHistoryCreation({ operationId, context }) {
    if (!context || !this.#projectSession.matches(context) || this.#snapshot.navigation.phase !== "idle") return;
    const generation = ++this.#creationGeneration;
    try {
      const result = this.#validateHistoryCreation(await this.#bridgeClient.queryHistoryCreation({ target: context, operationId }), context, operationId);
      if (!this.#projectSession.matches(context)) return;
      let phase = this.#historyCreationPhase(result);
      // Hydration may already have opened this very Working Copy. Confirm its
      // existing Canvas, never reopen a receipt merely to repair openedAt.
      if (phase === "created" && context.workingCopyId === result.workingCopyId
        && this.#versionSession.snapshot.currentBasedOnVersionId === result.versionId
        && this.#versionSession.snapshot.viewMode === "current") {
        const canvasAuthority = this.#documentSession.canvasAuthority;
        const canvasAlreadyVerified = canvasAuthority?.status === "verified"
          && canvasAuthority.renderedSha256 === result.contentSha256
          && this.#documentSession.persistedSourceSha256 === result.contentSha256;
        try {
          const verifyCurrentCanvas = async () => {
            if (canvasAlreadyVerified) return;
            if (typeof this.#canvasPort.requestFrame === "function") {
              await new Promise((resolve) => {
                this.#canvasPort.requestFrame(() => this.#canvasPort.requestFrame(resolve));
              });
            }
            try {
              await this.#canvasPort.verifyRendered(
                this.#documentSession.html,
                this.#documentSession.persistedSourceSha256,
                context,
              );
            } catch (firstCause) {
              // Startup hydration can publish the current identity one frame
              // before the disposable Canvas has settled. Re-check once at
              // the next frame instead of leaving a creation receipt pending
              // because of that presentation race.
              await new Promise((resolve) => setTimeout(resolve, 250));
              try {
                await this.#canvasPort.verifyRendered(
                  this.#documentSession.html,
                  this.#documentSession.persistedSourceSha256,
                  context,
                );
              } catch {
                throw firstCause;
              }
            }
          };
          await verifyCurrentCanvas();
          if (!this.#projectSession.matches(context) || generation !== this.#creationGeneration
            || this.#snapshot.navigation.phase !== "idle") return;
          phase = "opened";
          try { await this.#bridgeClient.confirmHistoryCreationOpened({ target: context, operationId }); } catch { /* The verified current Canvas is already usable. */ }
        } catch { /* Keep the committed result available for explicit opening. */ }
      }
      if (!this.#projectSession.matches(context)) return;
      this.#setHistoryCreation({ phase, operationId, context, result }, generation);
    } catch {
      if (this.#projectSession.matches(context)) this.#setHistoryCreation({ phase: "unknown", operationId, context }, generation);
    }
  }

  async openCreatedHistoryVersion({
    operationId,
    context = this.#projectSession.context,
    currentSurfaceCommitScope = null,
  } = {}) {
    const current = copyContext(context);
    if (!current || !this.#projectSession.matches(current)) return stale(current || {});
    if (this.#runSession.activeLocked) return blocked("HISTORY_CREATION_RUN_LOCKED", "请先完成当前 AI 任务或候选的处理。");
    const operation = this.#beginNavigation("opening", current);
    if (!operation) return blocked("VERSION_NAVIGATION_BUSY", "版本操作正在进行。");
    const generation = ++this.#creationGeneration;
    let result;
    try {
      result = this.#validateHistoryCreation(await this.#bridgeClient.queryHistoryCreation({ target: current, operationId }), current, operationId);
      if (result.status !== "created") {
        this.#setHistoryCreation({ phase: "not-created", operationId, context: current, result }, generation);
        return rejected("HISTORY_NOT_CREATED", "尚未创建新版本，可以重试。");
      }
      if (result.recoveryState === "superseded") {
        this.#setHistoryCreation({ phase: "superseded", operationId, context: current, result }, generation);
        return blocked("HISTORY_CREATION_SUPERSEDED", "项目已继续到其他版本，旧创建结果无需重新打开。");
      }
      this.#setHistoryCreation({ phase: "opening", operationId, context: current, result }, generation);
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      // The creation command drained the replaced current source before its
      // durable receipt was written. Retrying that exact receipt must not drain
      // the now-superseded source again: the managed history creation itself
      // may have changed those bytes, which the external-write guard correctly
      // reports as a conflict until this verified transition takes ownership.
      const payload = await this.#bridgeClient.workspace(result.sourcePath);
      const decoded = decodeWorkspaceResponse(payload, this.#codecs);
      const target = payload.openTarget;
      const content = String(payload.content || "");
      const sha256 = String(payload.currentHtmlSha256 || payload.sourceSha256 || "");
      if (payload.projectId !== current.projectId || payload.documentId !== current.documentId
        || payload.currentBasedOnVersionId !== result.versionId || payload.latestVersionId !== result.versionId
        || target?.targetKind !== "working-copy" || target.projectId !== current.projectId
        || target.documentId !== current.documentId || target.versionId !== result.versionId
        || target.workingCopyId !== result.workingCopyId || target.exactSourcePath !== result.sourcePath
        || target.sourceSha256 !== sha256 || !SHA256.test(sha256)
        || !decoded.versions.some((version) => version.id === result.versionId && version.contentSha256 === result.contentSha256)
        || await this.#hashPort.sha256(content) !== sha256) {
        throw new Error("已创建版本的工作文件身份或内容校验失败。");
      }
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      const latestReceipt = this.#validateHistoryCreation(await this.#bridgeClient.queryHistoryCreation({ target: current, operationId }), current, operationId);
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      if (latestReceipt.status !== "created" || latestReceipt.recoveryState === "superseded") {
        this.#setHistoryCreation({ phase: this.#historyCreationPhase(latestReceipt), operationId, context: current, result: latestReceipt }, generation);
        return blocked("HISTORY_CREATION_SUPERSEDED", "项目已继续迭代，停止打开旧创建结果。");
      }
      const prepared = await this.#projectWorkflow.prepareManagedSourceTransition({
        previousSourcePath: current.sourcePath, nextSourcePath: result.sourcePath,
        expectedSha256: sha256, nextProjectId: current.projectId, nextDocumentId: current.documentId,
        versionId: result.versionId, openTarget: target, operationId,
      });
      if (!this.#isNavigationCurrent(operation)) {
        return prepared?.coordination?.operationId
          ? unknown(
            operationId,
            "桌面工作文件已完成激活，但当前版本导航已经变化，请按同一操作重新核对。",
          )
          : stale(current);
      }
      const nextContext = this.#projectWorkflow.commitManagedSourceTransition({
        prepared, html: content, sourceSha256: sha256,
        publishSessions: (publishedContext) => {
          this.#versionSession.hydrate({ versions: decoded.versions,
            latestVersionId: payload.latestVersionId, currentBasedOnVersionId: result.versionId,
            currentExactVersionId: payload.currentExactVersionId, restoredFromVersionId: payload.restoredFromVersionId });
          this.#versionSession.returnCurrent();
          this.#draftSession.replaceAuthority(publishedContext, decoded.draft.draftRevision, decoded.draft);
          this.#commentSession.update({ comments: decoded.comments, changeEvents: decoded.changeEvents,
            deletedCommentIds: decoded.draft.deletedCommentIds, composerDraft: "", composerCommentId: null,
            composerAttachments: [], composerTarget: null, editSession: null });
        },
      });
      if (!nextContext || !this.#projectSession.matches(nextContext)) {
        return prepared?.coordination?.operationId
          ? unknown(operationId, "桌面工作文件已完成激活，但本地项目状态待同一操作核对。")
          : stale(current);
      }
      if (this.#currentSurfacePort?.commit) {
        const surface = await this.#currentSurfacePort.commit({
          context: nextContext,
          currentSurfaceCommitScope,
        });
        if (surface?.status !== "succeeded") {
          throw new Error(surface?.reason || "新当前稿权威已发布，但当前稿标签未能打开。");
        }
      }
      this.#setHistoryCreation({ phase: "opening", operationId, context: nextContext, result }, generation);
      await this.#canvasPort.verifyRendered(content, sha256, nextContext);
      if (!this.#isNavigationActive(operation) || !this.#projectSession.matches(nextContext)) return stale(nextContext);
      // A lost opened acknowledgement cannot turn an already opened file into
      // another creation. The durable receipt remains queryable on restart.
      try { await this.#bridgeClient.confirmHistoryCreationOpened({ target: nextContext, operationId }); } catch { /* Retry acknowledgement on the next explicit open. */ }
      this.#setHistoryCreation({ phase: "opened", operationId, context: nextContext, result }, generation);
      this.#documentWorkflow.clearAudit();
      this.#documentWorkflow.clearRecovery(nextContext);
      this.#projectWorkflow.scheduleProjectListRefreshAfterSettlement(nextContext);
      this.#emitEvent({ type: "version-history-created-opened", context: nextContext, versionId: result.versionId });
      return succeeded(result);
    } catch (cause) {
      const active = this.#projectSession.context;
      const owner = active?.projectId === current.projectId && active?.documentId === current.documentId ? active : current;
      this.#setHistoryCreation({ phase: result?.status === "created" ? "open-failed" : "unknown", operationId, context: owner, result }, generation);
      if (cause?.projectOutcome === "unknown") {
        return unknown(
          operationId,
          this.#codecs.errorMessage(cause, "桌面工作文件已完成激活，但本地项目状态待同一操作核对。"),
        );
      }
      return result?.status === "created"
        ? rejected("HISTORY_CREATED_OPEN_FAILED", this.#codecs.errorMessage(cause, "新版本已创建，但打开失败。可以打开已创建版本。"))
        : unknown(operationId, "暂时无法确认创建结果，请查询同一操作。");
    } finally {
      if (this.#snapshot.creation?.phase === "opening") this.#setHistoryCreation({ ...this.#snapshot.creation, phase: "created" }, generation);
      this.#finishNavigation(operation);
    }
  }

  async #openCommittedVersion({
    run,
    payload,
    reviewLease,
    operation,
    activationOperationId = null,
  }) {
    perfMark("stemmio:accept:open-start");
    const completion = this.#committedPayload(run, payload);
    if (payload.openTarget && payload.openTarget.versionId !== completion.versionId) {
      return blocked("VERSION_ACTIVATION_SUPERSEDED", "当前稿已进入后续版本，原有采纳结果保留在历史中。");
    }
    const committedSourcePath = String(
      payload.sourcePath
      || payload.currentPath
      || payload.workingCopyPath
      || run.sourcePath,
    );
    // An explicit activation response already carries the authoritative
    // post-promotion bytes. Reusing them skips re-reading megabytes over the
    // Bridge while the review overlay is still blocking the user; identity
    // and hash verification below still run on these bytes before they may
    // reach the canvas, and an incomplete payload falls back to the read-back.
    const inline = this.#inlineActivatedSource(payload);
    let source = inline;
    if (!source) {
      const [versionPayload, sourcePayload] = await Promise.all([
        this.#bridgeClient.versionFile(committedSourcePath, completion.versionId),
        this.#bridgeClient.source(committedSourcePath),
      ]).catch((cause) => {
        if (!activationOperationId) throw cause;
        // Promotion already committed. Keep its decision alive while reads are
        // unavailable so reconciliation cannot drain the replaced draft or
        // start another adoption. Identity and hash rejection stays below.
        throw Object.assign(new Error("已采用版本的内容暂时无法读取。", { cause }), {
          projectOutcome: "unknown",
        });
      });
      if (!this.#isNavigationCurrent(operation)) return stale(this.#runIdentity(run));
      this.#assertVersionFileIdentity(versionPayload, run, completion.versionId);
      this.#assertSourceIdentity(sourcePayload, run, { allowSourceTransition: true });
      const versionContent = String(versionPayload.content || "");
      if (versionContent !== String(sourcePayload.content || "")) {
        throw new Error("版本快照、源 HTML 与完成记录的 Hash 不一致，已停止打开。");
      }
      source = {
        content: versionContent,
        versionSha256: String(versionPayload.sha256 || versionPayload.contentSha256 || ""),
        sourceSha256: String(sourcePayload.sha256 || sourcePayload.sourceSha256 || ""),
        sourcePath: String(sourcePayload.sourcePath || committedSourcePath),
        lastModifiedAt: String(sourcePayload.lastModifiedAt || ""),
      };
    } else {
      this.#assertVersionFileIdentity(payload, run, completion.versionId);
      this.#assertSourceIdentity(payload, run, { allowSourceTransition: true });
    }
    perfMark("stemmio:accept:read-end");
    const content = source.content;
    const versionSha256 = source.versionSha256;
    const sourceSha256 = source.sourceSha256;
    const resolvedCommittedSourcePath = source.sourcePath;
    const lastModifiedAt = source.lastModifiedAt;
    const contentHash = await this.#hashPort.sha256(content);
    if (!this.#isNavigationCurrent(operation)) return stale(this.#runIdentity(run));
    if (
      versionSha256 !== completion.expectedSha256
      || sourceSha256 !== completion.expectedSha256
      || !SHA256.test(versionSha256)
      || contentHash !== versionSha256
    ) {
      throw new Error("版本快照、源 HTML 与完成记录的 Hash 不一致，已停止打开。");
    }
    perfMark("stemmio:accept:hash-end");
    if (!validTimestamp(lastModifiedAt)) {
      throw new Error("当前源 HTML 缺少独立的最后修改时间，已停止打开。");
    }

    // Current/background classification and any canvas/recovery mutation must
    // use the response's complete authority tuple. Never borrow project,
    // document, path, hash, or version identity from the frozen run or a
    // surrounding workspace when the response omits or mismatches it.
    const verifiedOpenTarget = verifyOpenTarget(payload.openTarget, {
      projectId: run.projectId,
      documentId: run.documentId,
      sourcePath: resolvedCommittedSourcePath,
      sourceSha256,
      sameSourcePath: this.#codecs.sameSourcePath,
      targetKind: "working-copy",
    });
    if (
      !verifiedOpenTarget
      || String(verifiedOpenTarget.versionId || "") !== String(completion.versionId || "")
    ) {
      throw new Error("已生成版本的工作文件 OpenTarget 不完整或身份不一致，已停止打开。");
    }

    const activeContext = this.#projectSession.context;
    const affectsCurrentCanvas = Boolean(
      activeContext
      && activeContext.projectId === run.projectId
      && activeContext.documentId === run.documentId
      && (
        this.#codecs.sameSourcePath(activeContext.sourcePath, run.sourcePath)
        || this.#codecs.sameSourcePath(activeContext.sourcePath, resolvedCommittedSourcePath)
      ),
    );
    if (affectsCurrentCanvas) {
      const alreadyFencedForReview = Boolean(
        reviewLease
        && reviewLease.operationKey === this.#codecs.operationKey(run)
        && reviewLease.beforeHtml === this.#documentSession.html,
      );
      if (!alreadyFencedForReview) {
        const frozen = this.#freezeCurrentCanvas(
          "新版本已生成，但当前编辑画布尚未就绪。",
        );
        if (!frozen.ok) throw new Error(frozen.reason);
      }
      if (!this.#projectSession.matches(activeContext)) {
        return stale(activeContext);
      }
      this.#documentWorkflow.clearRecovery(activeContext);
    }

    const prepared = await this.#projectWorkflow.prepareManagedSourceTransition({
      previousSourcePath: run.sourcePath,
      nextSourcePath: resolvedCommittedSourcePath,
      expectedSha256: sourceSha256,
      nextProjectId: run.projectId,
      nextDocumentId: run.documentId,
      versionId: completion.versionId,
      openTarget: verifiedOpenTarget,
      operationId: activationOperationId || operation.operationId,
    });
    if (!this.#isNavigationCurrent(operation)) {
      return prepared?.coordination?.operationId
        ? unknown(
          activationOperationId || operation.operationId,
          "版本工作文件已完成激活，但当前版本导航已经变化，请按同一操作重新核对。",
        )
        : stale(this.#runIdentity(run));
    }
    if (
      prepared?.updatesCurrentProject
      && !this.#codecs.sameSourcePath(run.sourcePath, resolvedCommittedSourcePath)
      && prepared?.activatedProject?.sha256 !== sourceSha256
    ) {
      return unknown(
        activationOperationId || operation.operationId,
        "桌面工作文件已返回，但本地项目状态缺少同一 Hash 的完整回执。",
      );
    }
    if (!prepared.updatesCurrentProject) {
      this.#projectWorkflow.scheduleProjectListRefreshAfterSettlement(
        this.#projectSession.context,
      );
      return succeeded({
        current: false,
        context: null,
        versionId: completion.versionId,
        candidateLabel: completion.candidateLabel,
        protocolViolation: completion.protocolViolation,
        aiCompletedAt: completion.aiCompletedAt,
        committedSourcePath: resolvedCommittedSourcePath,
        lastModifiedAt,
      });
    }
    const context = this.#projectWorkflow.commitManagedSourceTransition({
      prepared,
      html: content,
      sourceSha256,
      publishSessions: (publishedContext) => {
        this.#versionSession.adoptCommitted(completion.versionId);
        const retained = payload.retainedDraft;
        this.#draftSession.replaceAuthority(publishedContext, Number(retained?.draftRevision || 0), retained || emptyDraftAuthority());
        this.#commentSession.reset();
        if (retained?.comments?.length) this.#commentSession.update({
          comments: this.#codecs.commentsFromRecords(retained.comments), changeEvents: [],
        });
      },
    });
    if (!context || !this.#projectSession.matches(context)) {
      return prepared?.coordination?.operationId
        ? unknown(
          activationOperationId || operation.operationId,
          "版本工作文件已完成激活，但本地项目状态待同一操作核对。",
        )
        : stale(this.#runIdentity(run));
    }
    perfMark("stemmio:accept:commit-end");

    // Durable promotion and complete Session publication are the user-facing
    // cut. Canvas verification remains mandatory, but it warms the sole edit
    // surface after the committed bytes are already eligible for display.
    this.#emitEvent({
      type: "version-activation-published",
      context,
      operationKey: this.#codecs.operationKey(run),
      candidateLabel: completion.candidateLabel,
      committedSourcePath: resolvedCommittedSourcePath,
      lastModifiedAt,
    });

    try {
      await this.#canvasPort.verifyRendered(content, versionSha256, context);
    } catch (cause) {
      // Promotion has already published the durable source and Version
      // identity. A disposable Canvas failure therefore enters the existing
      // DocumentWorkflow recovery owner instead of reopening adoption or
      // clearing the lock as if the promotion had not happened.
      // Publication advances the source context. Fence the still-active
      // navigation and its newly published context, not the pre-adoption one.
      if (!this.#isNavigationActive(operation) || !this.#projectSession.matches(context)) {
        return stale(context);
      }
      const reason = this.#codecs.errorMessage(
        cause,
        "新版本已经采用，但当前页面尚未完成恢复。",
      );
      this.#documentWorkflow.markCanvasRecoveryRequired?.({
        context,
        error: reason,
      });
      this.#emitEvent({
        type: "version-activation-canvas-failed",
        context,
        operationKey: this.#codecs.operationKey(run),
        reason,
      });
      return rejected(VERSION_ACTIVATION_PAGE_RECOVERY_REQUIRED, reason, {
        recovery: Object.freeze({
          context,
          committedSourcePath: resolvedCommittedSourcePath,
          candidateLabel: completion.candidateLabel,
          protocolViolation: completion.protocolViolation,
          aiCompletedAt: completion.aiCompletedAt,
          versionId: completion.versionId,
        }),
      });
    }
    perfMark("stemmio:accept:canvas-verified");
    if (!this.#isNavigationActive(operation) || !this.#projectSession.matches(context)) {
      return stale(context);
    }

    return this.#finalizeCommittedVersion({
      context,
      committedSourcePath: resolvedCommittedSourcePath,
      versionId: completion.versionId,
      candidateLabel: completion.candidateLabel,
      protocolViolation: completion.protocolViolation,
      aiCompletedAt: completion.aiCompletedAt,
      lastModifiedAt,
    });
  }

  #finalizeCommittedVersion({
    context,
    committedSourcePath,
    versionId,
    candidateLabel,
    protocolViolation = false,
    aiCompletedAt = "",
    lastModifiedAt = "",
  } = {}) {
    if (!context || !this.#projectSession.matches(context)) {
      return stale(context || {});
    }
    const authorityReceipt = this.#documentSession.sourceReceipt;
    this.#documentWorkflow.clearAudit();
    this.#documentSession.markPersistenceIdle();

    this.#commentWorkflow.queueDraft();
    this.#documentWorkflow.clearRecovery(context);

    // Workspace re-hydration only refreshes project metadata for panels; the
    // Version bytes on the canvas are verified above. Keep the current
    // authority receipt attached so hydration cannot replace the verified
    // generation or reintroduce page recovery while the adoption settles.
    const refreshFallback = "新版本已打开，但项目资料尚未完成复核。";
    void this.#projectWorkflow.refreshWorkspace({
      sourcePath: committedSourcePath,
      epoch: context.epoch,
      authorityReceiptContinuation: authorityReceipt,
    }).then((refreshed) => {
      if (refreshed.status === "succeeded" || refreshed.status === "stale") return;
      this.#emitEvent({
        type: "version-refresh-warning",
        context,
        candidateLabel,
        reason: refreshed.reason || refreshFallback,
      });
    }).catch((cause) => {
      this.#emitEvent({
        type: "version-refresh-warning",
        context,
        candidateLabel,
        reason: this.#codecs.errorMessage(cause, refreshFallback),
      });
    });
    perfMark("stemmio:accept:refresh-end");

    this.#projectWorkflow.scheduleProjectListRefreshAfterSettlement(context);

    return succeeded({
      current: true,
      context,
      versionId,
      candidateLabel,
      protocolViolation,
      aiCompletedAt,
      committedSourcePath,
      lastModifiedAt,
    });
  }

  #committedPayload(run, payload) {
    const version = this.#codecs.isRecord(payload.version) ? payload.version : {};
    const outcome = this.#codecs.isRecord(payload.outcome) ? payload.outcome : {};
    const completion = this.#codecs.isRecord(payload.completion) ? payload.completion : {};
    const declaredCompletionTimes = [
      completion.completedAt,
      outcome.completedAt,
      payload.completedAt,
    ].filter((value) => value !== undefined && value !== null && value !== "");
    const declaredVersionTimes = [
      version.generatedAt,
      outcome.generatedAt,
      payload.generatedAt,
    ].filter((value) => value !== undefined && value !== null && value !== "");
    const aiCompletedAt = String(declaredCompletionTimes[0] || "");
    const versionGeneratedAt = String(declaredVersionTimes[0] || "");
    if (!validTimestamp(aiCompletedAt) || !validTimestamp(versionGeneratedAt)) {
      throw new Error("完成结果缺少可审计的 AI 完成时间或版本生成时间。");
    }
    if (
      declaredCompletionTimes.some((value) => String(value) !== aiCompletedAt)
      || declaredVersionTimes.some((value) => String(value) !== versionGeneratedAt)
    ) {
      throw new Error("完成记录与版本记录的时间戳不一致，已拒绝打开。");
    }
    const declaredVersionIds = [
      payload.versionId,
      version.versionId,
      version.id,
      outcome.versionId,
      completion.versionId,
      run.candidateVersionId,
    ].filter((value) => value !== undefined && value !== null && value !== "");
    const versionId = String(declaredVersionIds[0] || "");
    const declaredContentHashes = [
      payload.contentSha256,
      version.contentSha256,
      outcome.contentSha256,
    ].filter((value) => value !== undefined && value !== null && value !== "");
    const expectedSha256 = String(
      declaredContentHashes[0]
      || payload.sourceSha256
      || payload.currentHtmlSha256
      || "",
    );
    if (!versionId || !SHA256.test(expectedSha256)) {
      throw new Error("完成结果缺少版本 ID 或内容 Hash。");
    }
    if (
      declaredVersionIds.some((value) => String(value) !== versionId)
      || declaredContentHashes.some((value) => String(value) !== expectedSha256)
    ) {
      throw new Error("完成记录与候选版本的 ID 或内容 Hash 不一致，已拒绝打开。");
    }
    for (const [field, expected] of [
      ["projectId", run.projectId],
      ["documentId", run.documentId],
      ["requestId", run.requestId],
      ["attemptId", run.attemptId],
    ]) {
      const declared = [payload[field], version[field], outcome[field], completion[field]]
        .filter((value) => value !== undefined && value !== null && value !== "");
      if (declared.some((value) => String(value) !== expected)) {
        throw new Error(`完成结果的 ${field} 与当前冻结任务不一致，已拒绝打开。`);
      }
    }
    if (run.candidateVersionId && versionId !== run.candidateVersionId) {
      throw new Error("完成结果的版本 ID 与系统预留候选版本不一致，已拒绝打开。");
    }
    return Object.freeze({
      versionId,
      expectedSha256,
      candidateLabel: String(payload.candidateDisplayVersionLabel || run.candidateVersionLabel),
      aiCompletedAt,
      protocolViolation: Boolean(payload.protocolViolation || outcome.protocolViolation),
    });
  }

  #candidateHash(run, fallback) {
    const payload = this.#codecs.isRecord(run.readyPayload) ? run.readyPayload : {};
    const version = this.#codecs.isRecord(payload.version) ? payload.version : {};
    return String(payload.contentSha256 || version.contentSha256 || fallback || "");
  }

  #readyOpenTarget(run) {
    const target = isRecord(run?.readyPayload?.openTarget)
      ? run.readyPayload.openTarget
      : null;
    const verifiedTarget = verifyOpenTarget(target, {
      projectId: run?.projectId,
      documentId: run?.documentId,
      sourcePath: run?.sourcePath,
      sourceSha256: run?.baseSnapshotSha256 || run?.sourceSha256 || null,
      sameSourcePath: this.#codecs.sameSourcePath,
      targetKind: "working-copy",
    });
    if (!verifiedTarget) {
      throw new Error("候选版本缺少其所属项目的完整工作文件身份，不能从其他项目借用当前页面。");
    }
    return verifiedTarget;
  }

  #activatedOpenTarget(run, payload) {
    const candidateHash = this.#candidateHash(run, "");
    const responseVersionId = String(payload?.versionId || "");
    const responseSourcePath = String(
      payload?.sourcePath
      || payload?.currentPath
      || payload?.workingCopyPath
      || "",
    );
    const target = verifyOpenTarget(payload?.openTarget, {
      projectId: run?.projectId,
      documentId: run?.documentId,
      sourcePath: responseSourcePath || null,
      sameSourcePath: this.#codecs.sameSourcePath,
      targetKind: "working-copy",
    });
    if (
      !target
      || !SHA256.test(candidateHash)
      || !responseVersionId
      || responseVersionId !== String(run?.candidateVersionId || "")
      || !/^ver_\d{4,}$/u.test(String(target.versionId || ""))
      || String(payload?.projectId || "") !== String(run?.projectId || "")
      || String(payload?.documentId || "") !== String(run?.documentId || "")
      || (responseSourcePath && !this.#codecs.sameSourcePath(target.exactSourcePath, responseSourcePath))
      || (String(target?.versionId || "") === responseVersionId
        && target.sourceSha256 !== candidateHash)
    ) {
      throw new Error("Candidate Promotion 返回的工作文件 OpenTarget 不完整或身份不一致。");
    }
    return target;
  }

  // A "version-activated" response comes from the same Bridge authority that
  // just committed the promotion transaction; its inline bytes replace the
  // immediate read-back. Anything missing or malformed disables the fast path
  // so the full read-back below re-establishes the source of truth.
  #inlineActivatedSource(payload) {
    const content = typeof payload?.content === "string" ? payload.content : "";
    const sha256 = String(payload?.contentSha256 || "");
    const sourcePath = String(payload?.sourcePath || "");
    const lastModifiedAt = String(payload?.lastModifiedAt || "");
    if (
      payload?.ok !== true
      || payload?.status !== "version-activated"
      || !content
      || !sourcePath
      || !SHA256.test(sha256)
      || String(payload?.sourceSha256 || sha256) !== sha256
      || !validTimestamp(lastModifiedAt)
    ) return null;
    return {
      content,
      versionSha256: sha256,
      sourceSha256: sha256,
      sourcePath,
      lastModifiedAt,
    };
  }

  #assertVersionFileIdentity(payload, owner, expectedVersionId) {
    const projectId = String(owner.projectId || "");
    const documentId = String(owner.documentId || "");
    if (
      String(payload?.projectId || "") !== projectId
      || String(payload?.documentId || "") !== documentId
      || String(payload?.versionId || "") !== String(expectedVersionId || "")
    ) {
      throw new Error("版本文件的项目、文档或版本身份与当前操作不一致。");
    }
  }

  #assertSourceIdentity(payload, owner, { allowSourceTransition = false } = {}) {
    if (
      String(payload?.projectId || "") !== String(owner.projectId || "")
      || String(payload?.documentId || "") !== String(owner.documentId || "")
      || (!allowSourceTransition && (
        payload?.sourcePath
        && !this.#codecs.sameSourcePath(payload.sourcePath, owner.sourcePath)
      ))
    ) {
      throw new Error("当前源 HTML 的项目身份发生变化，已拒绝切换视图。");
    }
  }

  #settleActivatedRun(
    run,
    value,
    { pageRecoveryRequired = false, pageRecoveryReason = "" } = {},
  ) {
    const warning = value.protocolViolation
      ? "内部 AI 的临时输出在最终化后又被修改；已提交版本本身未受影响。"
      : "";
    const completed = {
      ...run,
      sourcePath: value.committedSourcePath,
      candidateVersionLabel: value.candidateLabel,
      status: value.protocolViolation ? "error" : "complete",
      completionObserved: true,
      ...(warning ? { error: warning } : {}),
      ...(pageRecoveryRequired
        ? {
            pageRecoveryRequired: true,
            pageRecoveryReason: String(
              pageRecoveryReason || "新版本已经采用，但当前页面尚未完成恢复。",
            ),
          }
        : {}),
    };
    this.#runSession.setActiveRun(completed);
    this.#runSession.removeRun(run, { clearActive: false });
    this.#runSession.clearActiveHandoff();
    return Object.freeze(completed);
  }

  #freezeCurrentCanvas(reason) {
    const frozen = this.#canvasPort.freeze(reason);
    if (!frozen || !frozen.ok) {
      return {
        ok: false,
        reason: frozen?.reason || "当前编辑画布尚未完成安全收口。",
      };
    }
    if (frozen.html !== this.#documentSession.html) {
      return { ok: false, reason: "编辑画布的冻结快照与当前源 HTML 不一致。" };
    }
    return { ok: true, html: frozen.html };
  }

  #beginNavigation(phase, context) {
    if (this.#snapshot.navigation.phase !== "idle") return null;
    const operation = Object.freeze({
      operationId: this.#nextOperationId("navigation"),
      generation: ++this.#navigationGeneration,
      context: copyContext(context),
    });
    this.#setNavigation(phase, operation.operationId, operation.generation);
    return operation;
  }

  #finishNavigation(operation) {
    if (
      this.#snapshot.navigation.operationId !== operation.operationId
      || operation.generation !== this.#navigationGeneration
    ) return;
    this.#setNavigation("idle", null, operation.generation);
    if (!this.#runSession.activeLocked) {
      const unlock = () => this.#canvasPort.unlock();
      if (typeof this.#canvasPort.requestFrame === "function") {
        this.#canvasPort.requestFrame(unlock);
      } else {
        unlock();
      }
    }
  }

  #isNavigationCurrent(operation) {
    return Boolean(
      this.#isNavigationActive(operation)
      && (
        !operation.context
        || isProjectSurfaceContext(operation.context)
        || this.#projectSession.matches(operation.context)
      ),
    );
  }

  #acceptsSurfaceContext(context) {
    return Boolean(
      isProjectSurfaceContext(context)
      || this.#projectSession.matches(context),
    );
  }

  #runLockedForContext(context) {
    if (!this.#runSession.activeLocked) return false;
    const activeRun = this.#runSession.activeRun;
    if (!activeRun) return true;
    return activeRun.projectId && activeRun.documentId
      ? activeRun.projectId === context.projectId
        && activeRun.documentId === context.documentId
      : activeRun.sourcePath === context.sourcePath;
  }

  #isNavigationActive(operation) {
    return Boolean(
      !this.#disposed
      && operation
      && operation.generation === this.#navigationGeneration
      && this.#snapshot.navigation.operationId === operation.operationId,
    );
  }

  #deferCanvasCommand(kind, run, options = {}) {
    if (typeof this.#canvasPort.deferCommand !== "function") return null;
    let resolveDeferred;
    const outcome = new Promise((resolve) => {
      resolveDeferred = resolve;
    });
    const deferred = this.#canvasPort.deferCommand(
      kind,
      () => {
        Promise.resolve(run()).then(
          resolveDeferred,
          (cause) => resolveDeferred(rejected(
            "VERSION_DEFERRED_COMMAND_REJECTED",
            this.#codecs.errorMessage(cause, "延后的版本操作失败。"),
          )),
        );
      },
      {
        ...options,
        onDiscard: () => resolveDeferred(blocked(
          "VERSION_DEFERRED_COMMAND_DISCARDED",
          "当前项目已经变化，延后的版本操作没有执行。",
        )),
      },
    );
    return deferred ? outcome : null;
  }

  #readyRun(run) {
    if (
      !run
      || run.status !== "ready-to-open"
      || !run.readyPayload
      || !run.candidateVersionId
      || !this.#readyCandidate(run)
      || !this.#isCurrentReadyRun(run)
    ) return null;
    return run;
  }

  #readyCandidate(run) {
    const payload = isRecord(run?.readyPayload) ? run.readyPayload : null;
    const candidate = isRecord(payload?.candidate) ? payload.candidate : null;
    const candidateId = String(payload?.candidateId || "");
    if (
      !candidate
      || !/^candidate_[A-Za-z0-9_-]{8,160}$/u.test(candidateId)
      || String(candidate.candidateId || "") !== candidateId
      || String(run?.projectId || "") !== String(candidate.projectId || "")
      || String(run?.documentId || "") !== String(candidate.documentId || "")
      || String(run?.requestId || "") !== String(candidate.requestId || "")
      || String(run?.attemptId || "") !== String(candidate.attemptId || "")
      || String(run?.candidateVersionId || "") !== String(candidate.proposedVersionId || "")
      || (
        run?.sourceWorkingCopyId
        && String(run.sourceWorkingCopyId) !== String(candidate.sourceWorkingCopyId || "")
      )
    ) return null;
    return Object.freeze({ ...candidate, candidateId });
  }

  #isCurrentReadyRun(run) {
    return Boolean(
      this.#runMatches(this.#runSession.activeRun, run)
      && this.#runSession.activeRun?.status === "ready-to-open",
    );
  }

  #runMatches(left, right) {
    return sameRun(left, right, this.#codecs.sameSourcePath);
  }

  #runIdentity(run) {
    return Object.freeze({
      projectId: String(run?.projectId || ""),
      documentId: String(run?.documentId || ""),
      requestId: String(run?.requestId || ""),
      attemptId: String(run?.attemptId || ""),
      sourcePath: String(run?.sourcePath || ""),
    });
  }

  #nextOperationId(kind) {
    this.#operationSequence += 1;
    return [
      "version",
      String(kind),
      Math.max(0, Number(this.#clock.now()) || 0).toString(36),
      this.#operationSequence.toString(36),
    ].join("_");
  }

  #setNavigation(phase, operationId, generation = this.#navigationGeneration) {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      navigation: Object.freeze({
        phase,
        operationId: operationId ? String(operationId) : null,
        generation,
      }),
    });
    this.#canvasPort.onNavigationChange(phase !== "idle");
    this.#publishSnapshot();
  }

  #setReview(phase, operationId) {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      review: Object.freeze({
        phase,
        operationId: operationId ? String(operationId) : null,
      }),
    });
    this.#publishSnapshot();
  }

  #publishSnapshot() {
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // Presentation subscribers cannot alter Version authority.
      }
    }
  }

  #emitEvent(event) {
    const frozen = Object.freeze({ ...event });
    for (const listener of this.#eventListeners) {
      try {
        listener(frozen);
      } catch {
        // Presentation listeners cannot alter Version authority.
      }
    }
  }

  #outcomeFromCause(operationId, cause, fallbackCode, fallbackReason) {
    const reason = this.#codecs.errorMessage(cause, fallbackReason);
    if (
      (isBridgeRequestError(cause) && cause.outcome === "unknown")
      || cause?.projectOutcome === "unknown"
    ) {
      return unknown(operationId, reason);
    }
    return rejected(errorCode(cause, fallbackCode), reason);
  }
}

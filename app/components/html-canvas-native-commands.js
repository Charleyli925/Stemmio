import { sameSourceReceipt } from "../application/document-session.js";

export function nativeEditLeasesMatch(left, right) {
  return Boolean(
    left
    && left.sessionId === right.sessionId
    && left.domGeneration === right.domGeneration
    && left.sourceRevision === right.sourceRevision
    && left.hostId === right.hostId
  );
}

export class NativeEditRecoveryController {
  #pending = null;

  offer(intent) {
    this.#pending = Object.freeze({
      ...intent,
      receipt: intent.receipt,
      target: Object.freeze({ ...intent.target }),
      selection: Object.freeze({ ...intent.selection }),
    });
  }

  cancel() {
    const hadPending = this.#pending !== null;
    this.#pending = null;
    return hadPending;
  }

  takeIfCurrent(current) {
    const pending = this.#pending;
    if (!pending) return null;

    // Every completion attempt retires the intent. A stale frame, target, or
    // focus observation must never stay armed and steal focus later.
    this.#pending = null;
    if (
      current.focusAllowed !== true
      || !sameSourceReceipt(current.receipt, pending.receipt)
      || current.sourceSha256 !== pending.sourceSha256
      || current.canvasGeneration !== pending.canvasGeneration
      || current.targetId !== pending.target.id
      || !Number.isSafeInteger(current.frameGeneration)
      || current.frameGeneration <= pending.retiredFrameGeneration
    ) return null;
    return pending;
  }
}

function notifyDiscard(callback, reason) {
  if (!callback?.onDiscard) return;
  try {
    callback.onDiscard(reason);
  } catch {
    // Cancellation notification is bookkeeping only. It must never revive a
    // stale command or interrupt the source-authority session teardown.
  }
}

export class NativeDeferredCommandQueue {
  #pending = null;
  #scheduled = null;

  discardPendingNativeCommands(reason) {
    const pending = this.#pending;
    const scheduled = this.#scheduled;
    this.#pending = null;
    this.#scheduled = null;
    notifyDiscard(pending, reason);
    if (scheduled && scheduled !== pending) {
      notifyDiscard(scheduled, reason);
    }
  }

  deferNativeCommand(kind, run, payload, options, active) {
    if (!active) return false;
    const authority = options.authority ?? "user-explicit";
    const incumbent = this.#pending ?? this.#scheduled;
    if (authority === "system" && incumbent?.authority === "user-explicit") {
      try {
        options.onDiscard?.("blocked-by-user-command");
      } catch {
        // A lower-priority system callback is already fully discarded.
      }
      return true;
    }
    const queued = active.session.queuePendingCommand({
      kind,
      authority,
      payload,
    });
    if (!queued.queued) return false;
    this.discardPendingNativeCommands("superseded");
    this.#pending = {
      sequence: queued.sequence,
      kind,
      authority,
      session: active.session,
      lease: { ...active.lease },
      run,
      onDiscard: options.onDiscard,
    };
    return true;
  }

  takeReplayableNativeCommandForCompletedSession(active, currentLease) {
    const pending = this.#pending;
    const scheduled = this.#scheduled;
    const callback = pending ?? scheduled;
    if (
      !callback
      || callback.authority !== "user-explicit"
      || callback.session !== active.session
      || !nativeEditLeasesMatch(currentLease, callback.lease)
      || !nativeEditLeasesMatch(active.lease, callback.lease)
    ) return null;
    if (callback === pending) {
      const command = active.session.takePendingCommand();
      if (
        !command
        || command.sequence !== callback.sequence
        || command.kind !== callback.kind
      ) return null;
      this.#pending = null;
    } else {
      this.#scheduled = null;
    }
    return callback;
  }

  scheduleReplay(callback, schedule) {
    this.#scheduled = callback;
    schedule(() => {
      if (this.#scheduled !== callback) return;
      this.#scheduled = null;
      callback.run();
    });
  }

  drainPendingNativeCommand(session, context) {
    const active = context.getActive();
    const pending = this.#pending;
    if (
      !active
      || !pending
      || active.session !== session
      || pending.session !== session
      || !nativeEditLeasesMatch(context.getCurrentLease(), pending.lease)
      || !nativeEditLeasesMatch(active.lease, pending.lease)
    ) {
      if (pending?.session === session) {
        this.#pending = null;
        notifyDiscard(pending, "stale-session");
      }
      return;
    }
    const command = session.takePendingCommand();
    if (!command || command.sequence !== pending.sequence || command.kind !== pending.kind) {
      if (command) {
        this.#pending = null;
        notifyDiscard(pending, "stale-session");
      }
      return;
    }
    this.#pending = null;
    this.#scheduled = pending;
    context.schedule(() => {
      const current = context.getActive();
      if (
        this.#scheduled !== pending
        || !current
        || current.session !== session
        || !nativeEditLeasesMatch(context.getCurrentLease(), pending.lease)
      ) {
        if (this.#scheduled === pending) {
          this.#scheduled = null;
          notifyDiscard(pending, "stale-session");
        }
        return;
      }
      this.#scheduled = null;
      pending.run();
    });
  }
}

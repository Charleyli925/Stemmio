import type { CanvasMode } from "./types";

/**
 * The identity used by the presentation layer is deliberately smaller than a
 * source document.  The source receipt, Canvas generation and Preview attempt
 * have already been checked by their owners before they reach this module.
 * This module only decides which checked surface may be in front.
 */
export type DisplaySurface = CanvasMode;

export type DisplayLifecycle =
  | "active"
  | "superseded"
  | "closing"
  | "closed";

export type DisplayTarget = Readonly<{
  surface: DisplaySurface;
  identity: string;
  /** Same mounted Edit authority across an ordinary source revision. */
  continuityKey?: string | null;
  /** A historical Preview must retire when returning to a current Edit tab. */
  historical?: boolean;
}>;

export type DisplayHandoffReason =
  | "no-target"
  | "waiting-for-evidence"
  | "target-ready"
  | "target-failed"
  | "superseded"
  | "closed";

export type DisplayHandoffInput = Readonly<{
  /** The surface the user currently wants to see. */
  target: DisplayTarget | null;
  /** A target is ready only after its existing source/physical proof settles. */
  targetReady: boolean;
  /** Failure is terminal for this attempt until a new identity is supplied. */
  targetFailed: boolean;
  /** The last exact surface retained by a Canvas or Preview host. */
  retained: DisplayTarget | null;
  /** Whether the host is allowed to keep its retained surface while opening. */
  retainOutgoing: boolean;
  lifecycle?: DisplayLifecycle;
  /** Stable evidence labels supplied by the existing proof owners. */
  missingEvidence?: readonly string[];
}>;

export type DisplayHandoffDecision = Readonly<{
  target: DisplayTarget | null;
  /** The surface the user can actually see after this decision. */
  actual: DisplayTarget | null;
  /** Alias kept explicit at call sites that talk about the visible surface. */
  displayed: DisplayTarget | null;
  missingEvidence: readonly string[];
  canHandoff: boolean;
  keepOutgoing: boolean;
  releaseOutgoing: boolean;
  /** Retained surfaces are always inert while a handoff is pending. */
  outgoingInteractive: false;
  phase: "empty" | "opening" | "settled" | "failed" | "superseded" | "closed";
  reason: DisplayHandoffReason;
}>;

/** A short-lived Preview lease may outlive a successful Edit handoff, not a terminal one. */
export function allowsPreviewLeaseRetention(decision: DisplayHandoffDecision): boolean {
  return decision.phase === "opening" || decision.phase === "settled";
}

function uniqueEvidence(labels: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(labels.filter((label) => label.length > 0))]);
}

/**
 * Resolve one presentation handoff.  It has no DOM or HTML knowledge and
 * never decides whether a source or iframe is trustworthy; callers pass those
 * proofs as `targetReady` and `missingEvidence`.
 *
 * A retained surface is a visual fallback only.  A failed, superseded or
 * closing attempt releases it, which prevents a later retry from resurrecting
 * an old editable surface.  A pending target may keep the retained surface
 * only when the host explicitly says that the handoff is still visible.
 */
export function decideDisplayHandoff({
  target,
  targetReady,
  targetFailed,
  retained,
  retainOutgoing,
  lifecycle = "active",
  missingEvidence = [],
}: DisplayHandoffInput): DisplayHandoffDecision {
  const terminalLifecycle = lifecycle !== "active";
  const terminalReason = lifecycle === "closed" || lifecycle === "closing"
    ? "closed"
    : lifecycle === "superseded"
      ? "superseded"
      : null;
  const sameTarget = Boolean(
    target
    && retained
    && target.surface === retained.surface
    && target.identity === retained.identity,
  );
  const targetCanHandoff = Boolean(
    target
    && targetReady
    && !targetFailed
    && !terminalLifecycle,
  );

  let actual: DisplayTarget | null = null;
  let phase: DisplayHandoffDecision["phase"];
  let reason: DisplayHandoffReason;

  if (!target) {
    phase = "empty";
    reason = "no-target";
  } else if (terminalReason) {
    phase = terminalReason;
    reason = terminalReason;
  } else if (targetFailed) {
    phase = "failed";
    reason = "target-failed";
  } else if (targetCanHandoff) {
    actual = target;
    phase = "settled";
    reason = "target-ready";
  } else if (retained && retainOutgoing) {
    actual = retained;
    phase = "opening";
    reason = "waiting-for-evidence";
  } else {
    phase = "opening";
    reason = "waiting-for-evidence";
  }

  const targetEvidence = target && !targetReady && !targetFailed
    ? ["target-readiness"]
    : [];
  const terminalEvidence = terminalReason
    ? [terminalReason]
    : targetFailed
      ? ["target-failed"]
      : [];
  const evidence = uniqueEvidence([
    ...missingEvidence,
    ...targetEvidence,
    ...terminalEvidence,
  ]);
  const keepOutgoing = Boolean(
    actual
    && retained
    && actual.surface === retained.surface
    && actual.identity === retained.identity
    && !targetCanHandoff,
  );
  const releaseOutgoing = Boolean(
    retained
    && (
      !target
      || targetFailed
      || terminalLifecycle
      || (targetCanHandoff && !sameTarget)
      || (!targetCanHandoff && !keepOutgoing)
    ),
  );

  return Object.freeze({
    target,
    actual,
    displayed: actual,
    missingEvidence: evidence,
    canHandoff: targetCanHandoff,
    keepOutgoing,
    releaseOutgoing,
    outgoingInteractive: false,
    phase,
    reason,
  });
}

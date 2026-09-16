// Structured, privacy-safe diagnostics for the local real-HTML discovery
// boundary.  This module records where discovery stopped without retaining
// user HTML, paths, selectors or stack traces.

export const REAL_HTML_DISCOVERY_STAGES = Object.freeze({
  SOURCE_COPY: "source-copy",
  ELECTRON_LAUNCH: "electron-launch",
  PROJECT_READY: "project-ready",
  EDITABLE_READY: "editable-ready",
  WORKING_COPY: "working-copy",
  SOURCE_INDEX: "source-index",
  AUTHORED_TAB_DISCOVERY: "authored-tab-discovery",
  AUTHORED_TAB_ACTIVATION: "authored-tab-activation",
  AUTHORED_CANDIDATE_DISCOVERY: "authored-candidate-discovery",
  RUNTIME_GENERATED_DISCOVERY: "runtime-generated-discovery",
  CAPABILITY_PROBE: "capability-probe",
  CAPABILITY_NORMALIZATION: "capability-normalization",
  PREFLIGHT_INTEGRITY: "preflight-integrity",
  CLEANUP: "cleanup",
});

const STAGE_VALUES = new Set(Object.values(REAL_HTML_DISCOVERY_STAGES));
const MAX_RECORDED_FAILURES = 32;
const SAFE_PRECONDITION_KEYS = new Set([
  "authoredCandidateCount",
  "candidateCount",
  "candidateTabKnown",
  "corpusFileSelected",
  "editableReady",
  "electronLaunched",
  "manifestProduced",
  "pageReady",
  "preflightStarted",
  "probeCount",
  "readOnlyCorpus",
  "runtimeGeneratedTargetCount",
  "sourceBytesRead",
  "sourceCopyReady",
  "sourceElementCount",
  "sourceRead",
  "sourceSize",
  "sourceStillAvailable",
  "status",
  "tabKnown",
  "workingCopyReady",
]);

function safePreconditions(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key, nested]) => (
    SAFE_PRECONDITION_KEYS.has(key)
    && (typeof nested === "boolean"
      || (typeof nested === "number" && Number.isFinite(nested))
      || (typeof nested === "string" && nested.length <= 120))
  )));
}

function safeStage(stage) {
  return STAGE_VALUES.has(stage) ? stage : "unknown";
}

function safeCode(value, fallback = null) {
  return typeof value === "string" && /^[A-Z0-9_.:-]{1,120}$/u.test(value)
    ? value
    : fallback;
}

function safeSubstage(value) {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,79}$/u.test(value)
    ? value
    : null;
}

function safeTag(value) {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,31}$/u.test(value)
    ? value
    : null;
}

function safeHitKind(value) {
  return typeof value === "string" && /^[a-z][a-z0-9-]{0,63}$/u.test(value)
    ? value
    : null;
}

function safeGeneration(value) {
  return typeof value === "string" && /^(?:0|[1-9]\d*)$/u.test(value)
    ? value
    : null;
}

function safeFailureCause(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const cause = {
    substage: safeSubstage(value.substage),
    code: safeCode(value.code, null),
    targetIndex: Number.isInteger(value.targetIndex) && value.targetIndex >= 0
      ? value.targetIndex
      : null,
    targetTag: safeTag(value.targetTag),
    connected: typeof value.connected === "boolean" ? value.connected : null,
    frameGeneration: safeGeneration(value.frameGeneration),
    hitKind: safeHitKind(value.hitKind),
  };
  return Object.values(cause).some((entry) => entry !== null) ? cause : null;
}

function discoveryFailureClass(code) {
  if (typeof code !== "string") return "unknown";
  if (code.includes("UNSUPPORTED") || code.includes("NOT_APPLICABLE")) return "unsupported";
  if (
    code.startsWith("CAPABILITY_PROBE_")
    || code.startsWith("RUNTIME_GENERATED_")
    || code === "NO_EXACT_HIT_POINT"
  ) return "executor";
  if (code.startsWith("PREFLIGHT_") || code.startsWith("CORPUS_")) return "integrity";
  if (code.startsWith("ELECTRON_") || code.startsWith("PROJECT_")) return "environment";
  return "unknown";
}

export function createDiscoveryTrace() {
  return {
    currentStage: null,
    events: [],
    failures: [],
    suppressedFailureCount: 0,
    firstFailure: null,
  };
}

export function markDiscoveryStage(trace, stage, preconditions = {}) {
  if (!trace || typeof trace !== "object") return null;
  const event = {
    stage: safeStage(stage),
    preconditions: safePreconditions(preconditions),
  };
  trace.currentStage = event.stage;
  if (!trace.events.some((entry) => entry.stage === event.stage)) {
    trace.events.push(event);
  }
  return event;
}

export function recordDiscoveryFailure(
  trace,
  stage,
  diagnostic = {},
  preconditions = {},
) {
  if (!trace || typeof trace !== "object") return null;
  const code = safeCode(diagnostic.code, "DISCOVERY_FAILED");
  const failureBoundary = discoveryFailureClass(code);
  const failure = {
    stage: safeStage(stage),
    code,
    exactReason: safeCode(
      diagnostic.exactReason,
      code,
    ),
    classification: failureBoundary,
    failureBoundary,
    rootCause: "UNDETERMINED",
    preconditions: safePreconditions(preconditions),
  };
  const cause = safeFailureCause(diagnostic.cause);
  if (cause) failure.cause = cause;
  trace.currentStage = failure.stage;
  if (trace.failures.length < MAX_RECORDED_FAILURES) trace.failures.push(failure);
  else trace.suppressedFailureCount += 1;
  if (!trace.firstFailure) trace.firstFailure = failure;
  return failure;
}

export function recordDiscoveryObservation(
  trace,
  stage,
  outcome,
  details = {},
) {
  if (!trace || typeof trace !== "object") return null;
  const event = {
    stage: safeStage(stage),
    outcome: typeof outcome === "string" && outcome ? outcome : "observed",
    details: safePreconditions(details),
  };
  trace.currentStage = event.stage;
  trace.events.push(event);
  return event;
}

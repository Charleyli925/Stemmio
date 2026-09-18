/** @typedef {import("./agent-credential-operation-contract.js").AgentCredentialOperationInput} AgentCredentialOperationInput */
/** @typedef {import("./agent-credential-operation-contract.js").AgentCredentialOperationKind} AgentCredentialOperationKind */
/** @typedef {import("./agent-credential-operation-contract.js").AgentCredentialOperationResult} AgentCredentialOperationResult */
/** @typedef {import("./agent-credential-operation-contract.js").AgentCredentialOperationStatus} AgentCredentialOperationStatus */

const SAFE_RECORD_ID = /^(?:cred|legacy)_[a-f0-9]{24,32}$/u;
const STATUS_PRIORITY = Object.freeze([
  "unreadable",
  "unavailable",
  "rejected",
  "unknown",
  "superseded",
  "missing",
  "saved",
]);

/**
 * @param {unknown} value
 * @returns {value is Readonly<Record<string, unknown>>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value */
export function isAgentCredentialRecordId(value) {
  return SAFE_RECORD_ID.test(String(value || ""));
}

/**
 * Interprets every credential-store response with one precedence and identity
 * contract. `remembered` is compatibility metadata, never saved authority.
 *
 * @param {AgentCredentialOperationInput} input
 * @param {{kind?: AgentCredentialOperationKind, expectedOperationId?: string | null}} [options]
 * @returns {AgentCredentialOperationResult}
 */
export function interpretAgentCredentialOperation(input, options = {}) {
  const value = isRecord(input) ? input : {};
  const kind = options.kind || "startup";
  const expectedOperationId = String(options.expectedOperationId || "") || null;
  const operationId = String(value.operationId || "") || null;
  const rawStatus = String(value.status || "");
  /** @type {AgentCredentialOperationStatus} */
  let status = STATUS_PRIORITY.includes(rawStatus)
    ? /** @type {AgentCredentialOperationStatus} */ (rawStatus)
    : "unknown";

  if (value.reconnectRequired === true || value.unreadable === true || rawStatus === "unreadable") {
    status = "unreadable";
  } else if (value.available === false || rawStatus === "unavailable") {
    status = "unavailable";
  } else if (rawStatus === "rejected") {
    status = "rejected";
  } else if (expectedOperationId && operationId !== expectedOperationId) {
    status = "unknown";
  } else if (rawStatus === "unknown") {
    status = "unknown";
  } else if (rawStatus === "superseded") {
    status = "superseded";
  } else if (rawStatus === "missing") {
    status = "missing";
  } else if (rawStatus === "saved") {
    status = kind !== "clear" && isAgentCredentialRecordId(value.recordId)
      ? "saved"
      : "rejected";
  } else {
    status = "unknown";
  }

  const code = status === "unknown" && expectedOperationId && operationId !== expectedOperationId
    ? "AGENT_CREDENTIAL_OPERATION_MISMATCH"
    : String(value.code || "") || null;
  const recordId = status === "saved" ? String(value.recordId) : null;
  return Object.freeze({
    status,
    operationId,
    recordId,
    code,
    reason: String(value.reason || "") || null,
    terminal: ["saved", "missing", "superseded", "rejected"].includes(status),
  });
}

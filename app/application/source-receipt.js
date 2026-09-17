/** @typedef {import("./project-session.js").ProjectContext} ProjectContext */
/** @typedef {import("./source-receipt-contract.js").DocumentSourceReceipt} DocumentSourceReceipt */
/** @typedef {import("./source-receipt-contract.js").SourceReceiptInput} SourceReceiptInput */

const SOURCE_RECEIPT_ORIGINS = new Set([
  "local-edit",
  "history",
  "authority",
]);
const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const TARGET_FIELDS = [
  "projectRootPath",
  "targetKind",
  "workingCopyId",
  "versionId",
  "exactSourcePath",
  "sourceSha256",
  "sessionEpoch",
];

/** @param {unknown} value @returns {Record<string, unknown> | null} */
function objectRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? /** @type {Record<string, unknown>} */ (value)
    : null;
}

/** @param {unknown} value @returns {number} */
function revision(value) {
  const next = Number(value);
  return Number.isSafeInteger(next) && next >= 0 ? next : 0;
}

/** @param {unknown} value @returns {value is DocumentSourceReceipt["origin"]} */
function isSourceReceiptOrigin(value) {
  return typeof value === "string" && SOURCE_RECEIPT_ORIGINS.has(value);
}

/** @param {unknown} value @returns {value is number} */
function isNonNegativeSafeInteger(value) {
  return typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0;
}

/** @param {unknown} value @returns {value is string} */
function isNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}

/** @param {unknown} value @returns {value is string | null} */
function isNullableNonEmptyString(value) {
  return value === null || isNonEmptyString(value);
}

/** @param {unknown} input @returns {ProjectContext | null} */
function sourceReceiptContext(input) {
  const context = objectRecord(input);
  if (!context) return null;
  const epoch = Number(context.epoch);
  const projectId = String(context.projectId || "");
  const documentId = String(context.documentId || "");
  const sourcePath = String(context.sourcePath || "");
  if (!Number.isSafeInteger(epoch) || !projectId || !documentId || !sourcePath) return null;
  const hasTarget = TARGET_FIELDS.some((key) => Object.hasOwn(context, key));
  if (!hasTarget) {
    return Object.freeze({
      epoch,
      projectId,
      documentId,
      sourcePath,
    });
  }
  if (!TARGET_FIELDS.every((key) => Object.hasOwn(context, key))) return null;
  const targetKind = String(context.targetKind || "");
  if (targetKind !== "working-copy" && targetKind !== "version") return null;
  const projectRootPath = String(context.projectRootPath || "");
  const exactSourcePath = String(context.exactSourcePath || "");
  const sourceSha256 = String(context.sourceSha256 || "");
  const sessionEpoch = Number(context.sessionEpoch);
  if (
    !projectRootPath
    || !exactSourcePath
    || !SHA256.test(sourceSha256)
    || !Number.isSafeInteger(sessionEpoch)
    || (targetKind === "working-copy" && !String(context.workingCopyId || ""))
    || (targetKind === "version" && !String(context.versionId || ""))
  ) return null;
  return Object.freeze({
    epoch,
    projectId,
    documentId,
    sourcePath,
    projectRootPath,
    targetKind,
    workingCopyId: context.workingCopyId ? String(context.workingCopyId) : null,
    versionId: context.versionId ? String(context.versionId) : null,
    exactSourcePath,
    sourceSha256,
    sessionEpoch,
  });
}

/** @param {unknown} input @returns {boolean} */
function isSourceReceiptContext(input) {
  const context = objectRecord(input);
  if (!context) return false;
  if (
    !isNonNegativeSafeInteger(context.epoch)
    || !isNonEmptyString(context.projectId)
    || !isNonEmptyString(context.documentId)
    || !isNonEmptyString(context.sourcePath)
  ) return false;
  const hasTarget = TARGET_FIELDS.some((key) => Object.hasOwn(context, key));
  if (!hasTarget) return true;
  if (!TARGET_FIELDS.every((key) => Object.hasOwn(context, key))) return false;
  if (
    !isNonEmptyString(context.projectRootPath)
    || (context.targetKind !== "working-copy" && context.targetKind !== "version")
    || !isNullableNonEmptyString(context.workingCopyId)
    || !isNullableNonEmptyString(context.versionId)
    || !isNonEmptyString(context.exactSourcePath)
    || typeof context.sourceSha256 !== "string"
    || !SHA256.test(context.sourceSha256)
    || !isNonNegativeSafeInteger(context.sessionEpoch)
    || (context.targetKind === "working-copy" && !isNonEmptyString(context.workingCopyId))
    || (context.targetKind === "version" && !isNonEmptyString(context.versionId))
  ) return false;
  return true;
}

/** @param {SourceReceiptInput} [input] @returns {DocumentSourceReceipt} */
export function createSourceReceipt(input = {}) {
  const normalizedSequence = revision(input.sequence);
  const normalizedOrigin = isSourceReceiptOrigin(input.origin) ? input.origin : "authority";
  const normalizedContext = sourceReceiptContext(input.context);
  return Object.freeze({
    sessionIncarnation: revision(input.sessionIncarnation),
    sequence: normalizedSequence,
    origin: normalizedOrigin,
    operationId: String(input.operationId || `${normalizedOrigin}-${normalizedSequence}`),
    editRevision: revision(input.editRevision),
    canvasGeneration: revision(input.canvasGeneration),
    sourceSha256: String(input.sourceSha256 || ""),
    context: normalizedContext,
    epoch: normalizedContext?.epoch ?? null,
    projectId: normalizedContext?.projectId || null,
    documentId: normalizedContext?.documentId || null,
    sourcePath: normalizedContext?.sourcePath || null,
    sessionEpoch: normalizedContext?.sessionEpoch ?? null,
  });
}

/** @param {unknown} value @returns {value is DocumentSourceReceipt} */
export function isSourceReceipt(value) {
  const receipt = objectRecord(value);
  if (!receipt) return false;
  const requiredFields = [
    "sessionIncarnation",
    "sequence",
    "origin",
    "operationId",
    "editRevision",
    "canvasGeneration",
    "sourceSha256",
    "context",
    "epoch",
    "projectId",
    "documentId",
    "sourcePath",
    "sessionEpoch",
  ];
  if (!requiredFields.every((key) => Object.hasOwn(receipt, key))) return false;
  if (
    !isNonNegativeSafeInteger(receipt.sessionIncarnation)
    || receipt.sessionIncarnation === 0
    || !isNonNegativeSafeInteger(receipt.sequence)
    || receipt.sequence === 0
    || !isSourceReceiptOrigin(receipt.origin)
    || !isNonEmptyString(receipt.operationId)
    || !isNonNegativeSafeInteger(receipt.editRevision)
    || !isNonNegativeSafeInteger(receipt.canvasGeneration)
    || typeof receipt.sourceSha256 !== "string"
    || (receipt.sourceSha256 !== "" && !SHA256.test(receipt.sourceSha256))
  ) return false;
  if (receipt.context === null) {
    return receipt.epoch === null
      && receipt.projectId === null
      && receipt.documentId === null
      && receipt.sourcePath === null
      && receipt.sessionEpoch === null;
  }
  if (!isSourceReceiptContext(receipt.context)) return false;
  const context = /** @type {ProjectContext} */ (receipt.context);
  return receipt.epoch === context.epoch
    && receipt.projectId === context.projectId
    && receipt.documentId === context.documentId
    && receipt.sourcePath === context.sourcePath
    && receipt.sessionEpoch === (context.sessionEpoch ?? null);
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
export function sameSourceReceiptContext(left, right) {
  const leftRecord = objectRecord(left);
  const rightRecord = objectRecord(right);
  if (leftRecord?.context == null && rightRecord?.context == null) return true;
  const a = sourceReceiptContext(leftRecord?.context || leftRecord);
  const b = sourceReceiptContext(rightRecord?.context || rightRecord);
  if (!a || !b) return false;
  return (
    a.epoch === b.epoch
    && a.projectId === b.projectId
    && a.documentId === b.documentId
    && a.sourcePath === b.sourcePath
    && String(a.projectRootPath || "") === String(b.projectRootPath || "")
    && String(a.targetKind || "") === String(b.targetKind || "")
    && String(a.workingCopyId || "") === String(b.workingCopyId || "")
    && String(a.versionId || "") === String(b.versionId || "")
    && a.exactSourcePath === b.exactSourcePath
    && a.sessionEpoch === b.sessionEpoch
    && String(a.sourceSha256 || "") === String(b.sourceSha256 || "")
  );
}

/** @param {unknown} left @param {unknown} right @returns {boolean} */
export function sameSourceReceipt(left, right) {
  return Boolean(
    isSourceReceipt(left)
    && isSourceReceipt(right)
    && left.sessionIncarnation === right.sessionIncarnation
    && left.sequence === right.sequence
    && left.origin === right.origin
    && left.operationId === right.operationId
    && left.editRevision === right.editRevision
    && left.canvasGeneration === right.canvasGeneration
    && left.sourceSha256 === right.sourceSha256
    && sameSourceReceiptContext(left, right)
  );
}

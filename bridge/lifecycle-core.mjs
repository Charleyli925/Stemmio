import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  hasCompleteDocumentStructure,
  serializeHtmlWithoutElementTokens,
} from "./html-source-parser.mjs";
import {
  semanticVersionLabel,
  workingCopyFileName,
} from "./product-contract.mjs";
import { nonReplaceTemporaryName } from "../shared/project-storage-contract.mjs";

export const LIFECYCLE_SCHEMA_VERSION = "3.0.0";
export const COMPLETION_SCHEMA_VERSION = "1.0.0";
export const AUXILIARY_SCHEMA_VERSION = "1.0.0";
export const FINALIZER_VERSION = "1.0.0";
export const CANONICALIZATION_VERSION = "1";
export const USER_SUPPLEMENT_SCHEMA_VERSION = "1.0.0";

export const MANAGED_META_NAMES = Object.freeze([
  "html-ai-document-id",
  "html-ai-version-id",
  "html-ai-version-label",
  "html-ai-based-on-version-id",
  "html-ai-request-id",
]);

const MANAGED_META_NAME_SET = new Set(MANAGED_META_NAMES);
const PROJECT_ID_PATTERN = /^project_[a-f0-9]{16,64}$/;
const DOCUMENT_ID_PATTERN = /^doc_[a-f0-9]{16,64}$/;
const REQUEST_ID_PATTERN = /^req_\d{4,}$/;
const ATTEMPT_ID_PATTERN = /^attempt_\d{3}$/;
const VERSION_ID_PATTERN = /^ver_\d{4,}$/;
// Current projects use a readable user-name-plus-version filename with a
// timestamped project identity suffix; no legacy projectId-only directory is
// accepted.
const PROJECT_STORAGE_DIRECTORY_PATTERN =
  /__(\d{8}-\d{6})__([a-f0-9]{8,32})$/;
const PROJECT_STORAGE_DIRECTORY_MAX_BYTES = 240;
const SUPPLEMENT_RECORD_ID_PATTERN = /^supplement_\d{4,}$/;
const SUPPLEMENT_ATTACHMENT_ID_PATTERN = /^suppatt_\d{4,}_\d{2}$/;
const SUPPLEMENT_REFERENCE_PATTERN = /^(?:instruction_[A-Za-z0-9_-]+|supplement_\d{4,})$/;
const SUPPLEMENT_ACTIONS = new Set(["add", "amend", "retract"]);
const SUPPLEMENT_EVIDENCE_STATES = new Set([
  "text-only",
  "original-file",
  "description-only",
]);
const ATTEMPT_ENTRY_NAMES = new Set([
  "output",
  // A sealed, pending-review Candidate is stored beside the finalized output.
  // It is not a formal Version artifact and must remain readable on retry.
  "candidate.json",
  "candidate-assessment.json",
  "completion.json",
  "scope-report.json",
  "result.json",
  "cancelled.json",
  "annotations.json",
  "outcome.json",
  "protocol-violation.json",
  "USER_SUPPLEMENT.md",
  "USER_SUPPLEMENT.json",
  "supplement-attachments",
  "validation-review.json",
]);
const MAX_SUPPLEMENT_RECORDS = 500;
const MAX_SUPPLEMENT_ATTACHMENTS = 10;
const MAX_SUPPLEMENT_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const MAX_SUPPLEMENT_TOTAL_ATTACHMENT_BYTES = 100 * 1024 * 1024;
const SUPPLEMENT_MEDIA_TYPES = new Map([
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".gif", "image/gif"],
  [".heic", "image/heic"],
  [".pdf", "application/pdf"],
  [".txt", "text/plain"],
  [".md", "text/markdown"],
  [".json", "application/json"],
  [".csv", "text/csv"],
  [".zip", "application/zip"],
]);

export class LifecycleError extends Error {
  constructor(code, message, details, status = 422) {
    super(message);
    this.name = "LifecycleError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function nowIso() {
  return new Date().toISOString();
}

export function sha256(bufferOrString) {
  return `sha256:${createHash("sha256").update(bufferOrString).digest("hex")}`;
}

export function sha256Hex(bufferOrString) {
  return createHash("sha256").update(bufferOrString).digest("hex");
}

export function jsonText(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function exists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function ensureDirectory(directory) {
  await mkdir(directory, { recursive: true });
  const information = await lstat(directory);
  if (information.isSymbolicLink() || !information.isDirectory()) {
    throw new LifecycleError(
      "UNSAFE_DIRECTORY",
      `${directory} must be a real directory.`,
      undefined,
      409,
    );
  }
}

function isFinderMetadataFile(entry) {
  return entry.name === ".DS_Store"
    && entry.isFile()
    && !entry.isSymbolicLink();
}

export function findUnexpectedAttemptEntry(entries) {
  return entries.find(
    (entry) =>
      !ATTEMPT_ENTRY_NAMES.has(entry.name)
      && !entry.name.startsWith(".failpoint-")
      && !isFinderMetadataFile(entry),
  );
}

export function findUnexpectedAttemptOutputEntry(
  entries,
  expectedFileName = "index.html",
) {
  return entries.find(
    (entry) =>
      !isFinderMetadataFile(entry)
      && (
        entry.name !== expectedFileName
        || entry.isSymbolicLink()
        || !entry.isFile()
      ),
  );
}

export async function syncDirectory(directory) {
  let handle;
  try {
    handle = await open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (!["EINVAL", "EISDIR", "EPERM"].includes(error?.code)) throw error;
  } finally {
    await handle?.close();
  }
}

export async function atomicWriteFile(filePath, content, options = {}) {
  const parent = path.dirname(filePath);
  await ensureDirectory(parent);
  // The final component may intentionally consume the filesystem's full
  // 255-byte budget, so the temporary sibling must not include that name.
  const temporary = path.join(
    parent,
    nonReplaceTemporaryName(`write-${process.pid}-${randomUUID()}.tmp`),
  );
  const operations = options.operations || {};
  const openFile = operations.open || open;
  const renameFile = operations.rename || rename;
  const removeFile = operations.rm || rm;
  const syncParentDirectory = operations.syncDirectory || syncDirectory;
  let handle = null;
  let temporaryCreated = false;
  let replacementCompleted = false;
  try {
    handle = await openFile(temporary, "wx", options.mode ?? 0o600);
    temporaryCreated = true;
    await handle.writeFile(content);
    await handle.sync();
    const closingHandle = handle;
    handle = null;
    await closingHandle.close();
    await renameFile(temporary, filePath);
    replacementCompleted = true;
    await syncParentDirectory(parent);
  } catch (error) {
    const cleanupErrors = [];
    if (handle) {
      const closingHandle = handle;
      handle = null;
      try {
        await closingHandle.close();
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (temporaryCreated && !replacementCompleted) {
      try {
        await removeFile(temporary, { force: true });
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    const details = {
      value: replacementCompleted ? "replaced-unconfirmed" : "not-replaced",
      configurable: true,
      enumerable: false,
    };
    const cleanupDetails = {
      value: Object.freeze([...cleanupErrors]),
      configurable: true,
      enumerable: false,
    };
    try {
      Object.defineProperties(error, {
        atomicWriteOutcome: details,
        cleanupErrors: cleanupDetails,
      });
      throw error;
    } catch (annotationError) {
      if (annotationError === error) throw error;
      const wrapped = new Error(String(error?.message || error), { cause: error });
      wrapped.name = "AtomicWriteError";
      if (error?.code) wrapped.code = error.code;
      Object.defineProperties(wrapped, {
        atomicWriteOutcome: details,
        cleanupErrors: cleanupDetails,
      });
      throw wrapped;
    }
  }
}

export async function atomicWriteJson(filePath, value) {
  await atomicWriteFile(filePath, jsonText(value));
}

export async function readJson(filePath, label = path.basename(filePath)) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new LifecycleError(
        "FILE_NOT_FOUND",
        `${label} was not found.`,
        undefined,
        404,
      );
    }
    throw error;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new LifecycleError(
      "INVALID_JSON_FILE",
      `${label} is not valid JSON.`,
    );
  }
}

export function assertSchemaVersion(value, expected, label) {
  const actual =
    value && typeof value === "object" && !Array.isArray(value)
      ? value.schemaVersion ?? null
      : null;
  if (actual !== expected) {
    throw new LifecycleError(
      "UNSUPPORTED_SCHEMA_VERSION",
      `${label} must use schema ${expected}.`,
      { expected, actual },
      409,
    );
  }
  return value;
}

export async function readVersionedJson(filePath, label, expected) {
  return assertSchemaVersion(
    await readJson(filePath, label),
    expected,
    label,
  );
}

export function isCompleteHtml(html) {
  if (typeof html !== "string") return false;
  const value = html.trim();
  return (
    value.length >= 60
    && !value.startsWith("```")
    && /<!doctype\s+html(?:\s|>)/i.test(value)
    && hasCompleteDocumentStructure(value)
  );
}

export function requireCompleteHtml(html, label = "HTML") {
  if (!isCompleteHtml(html)) {
    throw new LifecycleError(
      "INCOMPLETE_HTML",
      `${label} must be a complete HTML document.`,
    );
  }
}

export function comparisonSha256(html) {
  const serialized = serializeHtmlWithoutElementTokens(
    html,
    (token) =>
      token.name === "meta"
      && MANAGED_META_NAME_SET.has(
        token.attributes.get("name")?.toLowerCase() ?? "",
      ),
  );
  return sha256(Buffer.from(serialized, "utf8"));
}

function assertId(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new LifecycleError(
      `INVALID_${label.toUpperCase()}`,
      `${label} has an invalid format.`,
      undefined,
      400,
    );
  }
  return value;
}

export const assertProjectId = (value) =>
  assertId(value, PROJECT_ID_PATTERN, "project_id");
export const assertDocumentId = (value) =>
  assertId(value, DOCUMENT_ID_PATTERN, "document_id");
export const assertRequestId = (value) =>
  assertId(value, REQUEST_ID_PATTERN, "request_id");
export const assertAttemptId = (value) =>
  assertId(value, ATTEMPT_ID_PATTERN, "attempt_id");
export const assertVersionId = (value) =>
  assertId(value, VERSION_ID_PATTERN, "version_id");

function compactLocalTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) {
    throw new LifecycleError(
      "INVALID_PROJECT_CREATED_AT",
      "Project createdAt must be a valid timestamp.",
      undefined,
      400,
    );
  }
  const pad = (part) => String(part).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
  ].join("") + "-" + [
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

function truncateUtf8(value, maxBytes) {
  let result = "";
  let byteLength = 0;
  for (const character of value) {
    const nextBytes = Buffer.byteLength(character, "utf8");
    if (byteLength + nextBytes > maxBytes) break;
    result += character;
    byteLength += nextBytes;
  }
  return result;
}

export function projectDisplayName(sourcePath) {
  const sourceName = path.basename(sourcePath, path.extname(sourcePath));
  const normalized = sourceName
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || "未命名项目";
}

export function projectStorageDirectoryName({
  displayName,
  createdAt,
  projectId,
  suffixLength = 8,
}) {
  assertProjectId(projectId);
  const projectToken = projectId.slice("project_".length);
  const safeSuffixLength = Math.min(
    projectToken.length,
    Math.max(8, Number(suffixLength) || 8),
  );
  const suffix = projectToken.slice(0, safeSuffixLength);
  const timestamp = compactLocalTimestamp(createdAt);
  const fixedSuffix = `__${timestamp}__${suffix}`;
  const availableDisplayBytes =
    PROJECT_STORAGE_DIRECTORY_MAX_BYTES - Buffer.byteLength(fixedSuffix, "utf8");
  const normalizedDisplayName = String(displayName || "未命名项目")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^[.\s]+|[.\s]+$/g, "")
    || "未命名项目";
  const readablePrefix = truncateUtf8(
    normalizedDisplayName,
    availableDisplayBytes,
  ).replace(/[.\s]+$/g, "") || "项目";
  return `${readablePrefix}${fixedSuffix}`;
}

export function assertProjectStorageDirectoryName(value, projectId) {
  assertProjectId(projectId);
  if (
    typeof value !== "string"
    || value.length === 0
    || value !== value.trim()
    || value === "."
    || value === ".."
    || /[\u0000-\u001f\u007f/\\:*?"<>|]/.test(value)
    || Buffer.byteLength(value, "utf8") > PROJECT_STORAGE_DIRECTORY_MAX_BYTES
    || path.basename(value) !== value
  ) {
    throw new LifecycleError(
      "INVALID_PROJECT_STORAGE_DIRECTORY",
      "Project storageDirectoryName is invalid.",
      undefined,
      409,
    );
  }
  const match = value.match(PROJECT_STORAGE_DIRECTORY_PATTERN);
  if (
    !match
    || !projectId.slice("project_".length).startsWith(match[2])
  ) {
    throw new LifecycleError(
      "PROJECT_STORAGE_IDENTITY_MISMATCH",
      "Project storageDirectoryName does not match projectId.",
      undefined,
      409,
    );
  }
  return value;
}

export function projectDirectory(
  workspaceRoot,
  storageDirectoryName,
  projectId,
) {
  const safeDirectoryName = assertProjectStorageDirectoryName(
    storageDirectoryName,
    projectId,
  );
  return path.join(
    path.resolve(workspaceRoot),
    "projects",
    safeDirectoryName,
  );
}

export async function withProjectFileLock(projectRoot, task, options = {}) {
  const lockDirectory = path.join(projectRoot, ".lifecycle.lock");
  const timeoutMs = options.timeoutMs ?? 15_000;
  const staleMs = options.staleMs ?? 120_000;
  const startedAt = Date.now();

  while (true) {
    try {
      await mkdir(lockDirectory);
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const information = await stat(lockDirectory);
        if (Date.now() - information.mtimeMs > staleMs) {
          await rm(lockDirectory, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (statError?.code === "ENOENT") continue;
        throw statError;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        throw new LifecycleError(
          "PROJECT_LOCK_TIMEOUT",
          "The project is busy. Please retry.",
          undefined,
          409,
        );
      }
      await delay(20);
    }
  }

  try {
    await atomicWriteJson(path.join(lockDirectory, "owner.json"), {
      pid: process.pid,
      acquiredAt: nowIso(),
    });
    return await task();
  } finally {
    await rm(lockDirectory, { recursive: true, force: true });
  }
}

function assertSupplementObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_SCHEMA_INVALID",
      `${label} must be an object.`,
    );
  }
  return value;
}

function assertSupplementKeys(value, allowed, label) {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_SCHEMA_INVALID",
      `${label} contains unsupported field ${unexpected}.`,
    );
  }
}

function supplementText(value, label, maxLength, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined || value === "")) {
    return null;
  }
  if (typeof value !== "string") {
    throw new LifecycleError(
      "USER_SUPPLEMENT_SCHEMA_INVALID",
      `${label} must be text.`,
    );
  }
  const text = value.replaceAll("\0", "").trim();
  if (!text || text.length > maxLength) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_SCHEMA_INVALID",
      `${label} must contain 1-${maxLength} characters.`,
    );
  }
  return text;
}

function supplementTimestamp(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  const text = supplementText(value, label, 100);
  if (Number.isNaN(Date.parse(text))) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_SCHEMA_INVALID",
      `${label} must be an ISO timestamp.`,
    );
  }
  return text;
}

function supplementSha(value, label, { nullable = false } = {}) {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value)) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_SCHEMA_INVALID",
      `${label} must be a sha256 digest.`,
    );
  }
  return value;
}

function safeSupplementFileName(value) {
  const baseName = path.posix.basename(
    String(value ?? "").replaceAll("\\", "/"),
  );
  const cleaned = baseName
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replaceAll("/", "-")
    .trim();
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new LifecycleError(
      "USER_SUPPLEMENT_ATTACHMENT_INVALID",
      "Supplement attachment file name is invalid.",
    );
  }
  const extension = path.extname(cleaned).toLowerCase();
  if (!SUPPLEMENT_MEDIA_TYPES.has(extension)) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_ATTACHMENT_TYPE_UNSUPPORTED",
      `Supplement attachment type ${extension || "(none)"} is not supported.`,
    );
  }
  if (cleaned.length <= 180) return cleaned;
  return `${cleaned.slice(0, Math.max(1, 180 - extension.length))}${extension}`;
}

function emptyUserSupplementArchive(identity) {
  return {
    schemaVersion: USER_SUPPLEMENT_SCHEMA_VERSION,
    status: "active",
    projectId: identity.projectId,
    documentId: identity.documentId,
    requestId: identity.requestId,
    attemptId: identity.attemptId,
    records: [],
    sealedAt: null,
    recordsSha256: null,
    attachmentsSha256: null,
  };
}

function supplementRecordsSha256(records) {
  return sha256(Buffer.from(jsonText(records), "utf8"));
}

function supplementAttachmentsSha256(records) {
  const manifest = records.flatMap((record) => record.attachments).map(
    (attachment) => ({
      attachmentId: attachment.attachmentId,
      relativePath: attachment.relativePath,
      byteLength: attachment.byteLength,
      sha256: attachment.sha256,
    }),
  );
  return sha256(Buffer.from(jsonText(manifest), "utf8"));
}

export function activeUserSupplementRecords(records) {
  const active = new Map();
  for (const record of records) {
    if (record.action === "amend" || record.action === "retract") {
      for (const reference of record.refersTo) {
        if (SUPPLEMENT_RECORD_ID_PATTERN.test(reference)) active.delete(reference);
      }
    }
    if (record.action === "add" || record.action === "amend") {
      active.set(record.recordId, record);
    }
  }
  return records.filter((record) => active.has(record.recordId));
}

function activeSupplementRequirementCount(records) {
  return activeUserSupplementRecords(records).length;
}

function validateSupplementRecordShape(recordValue, index) {
  const record = assertSupplementObject(
    recordValue,
    `USER_SUPPLEMENT.json records[${index}]`,
  );
  assertSupplementKeys(record, new Set([
    "recordId",
    "recordedAt",
    "idempotencyKey",
    "action",
    "refersTo",
    "userText",
    "targetDescription",
    "evidenceState",
    "evidenceDescription",
    "attachments",
  ]), `USER_SUPPLEMENT.json records[${index}]`);
  if (!SUPPLEMENT_RECORD_ID_PATTERN.test(record.recordId ?? "")) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_SCHEMA_INVALID",
      `records[${index}].recordId is invalid.`,
    );
  }
  supplementTimestamp(record.recordedAt, `records[${index}].recordedAt`);
  supplementText(record.idempotencyKey, `records[${index}].idempotencyKey`, 180);
  if (!SUPPLEMENT_ACTIONS.has(record.action)) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_SCHEMA_INVALID",
      `records[${index}].action is invalid.`,
    );
  }
  if (!Array.isArray(record.refersTo) || record.refersTo.length > 50) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_SCHEMA_INVALID",
      `records[${index}].refersTo is invalid.`,
    );
  }
  const references = record.refersTo.map((reference) => {
    if (typeof reference !== "string" || !SUPPLEMENT_REFERENCE_PATTERN.test(reference)) {
      throw new LifecycleError(
        "USER_SUPPLEMENT_SCHEMA_INVALID",
        `records[${index}] contains an invalid reference.`,
      );
    }
    return reference;
  });
  if (new Set(references).size !== references.length) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_SCHEMA_INVALID",
      `records[${index}] contains duplicate references.`,
    );
  }
  if (["amend", "retract"].includes(record.action) && references.length === 0) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_REFERENCE_REQUIRED",
      `${record.action} records must refer to an earlier requirement.`,
    );
  }
  supplementText(record.userText, `records[${index}].userText`, 20_000);
  supplementText(
    record.targetDescription,
    `records[${index}].targetDescription`,
    4_000,
    { nullable: true },
  );
  if (!SUPPLEMENT_EVIDENCE_STATES.has(record.evidenceState)) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_SCHEMA_INVALID",
      `records[${index}].evidenceState is invalid.`,
    );
  }
  const evidenceDescription = supplementText(
    record.evidenceDescription,
    `records[${index}].evidenceDescription`,
    20_000,
    { nullable: true },
  );
  if (record.evidenceState === "description-only" && !evidenceDescription) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_EVIDENCE_DESCRIPTION_REQUIRED",
      "description-only evidence must include an explicit description.",
    );
  }
  if (!Array.isArray(record.attachments) || record.attachments.length > MAX_SUPPLEMENT_ATTACHMENTS) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_SCHEMA_INVALID",
      `records[${index}].attachments is invalid.`,
    );
  }
  if (
    record.evidenceState === "original-file"
    && record.attachments.length === 0
  ) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_ATTACHMENT_REQUIRED",
      "original-file evidence must include a managed attachment.",
    );
  }
  if (
    record.evidenceState !== "original-file"
    && record.attachments.length > 0
  ) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_EVIDENCE_STATE_MISMATCH",
      "Managed attachments require original-file evidence state.",
    );
  }
  return record;
}

async function validateSupplementAttachment(attemptRoot, attachmentValue, label) {
  const attachment = assertSupplementObject(attachmentValue, label);
  assertSupplementKeys(attachment, new Set([
    "attachmentId",
    "fileName",
    "mediaType",
    "byteLength",
    "sha256",
    "relativePath",
  ]), label);
  if (!SUPPLEMENT_ATTACHMENT_ID_PATTERN.test(attachment.attachmentId ?? "")) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_ATTACHMENT_INVALID",
      `${label}.attachmentId is invalid.`,
    );
  }
  const fileName = safeSupplementFileName(attachment.fileName);
  const mediaType = SUPPLEMENT_MEDIA_TYPES.get(path.extname(fileName).toLowerCase());
  if (attachment.mediaType !== mediaType) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_ATTACHMENT_INVALID",
      `${label}.mediaType does not match its file name.`,
    );
  }
  if (
    !Number.isSafeInteger(attachment.byteLength)
    || attachment.byteLength < 1
    || attachment.byteLength > MAX_SUPPLEMENT_ATTACHMENT_BYTES
  ) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_ATTACHMENT_INVALID",
      `${label}.byteLength is invalid.`,
    );
  }
  supplementSha(attachment.sha256, `${label}.sha256`);
  const expectedRelativePath =
    `supplement-attachments/${attachment.attachmentId}-${fileName}`;
  if (attachment.relativePath !== expectedRelativePath) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_ATTACHMENT_INVALID",
      `${label}.relativePath is invalid.`,
    );
  }
  const resolved = path.resolve(
    attemptRoot,
    ...attachment.relativePath.split("/"),
  );
  if (!resolved.startsWith(`${path.resolve(attemptRoot)}${path.sep}`)) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_ATTACHMENT_INVALID",
      `${label}.relativePath escapes the Attempt.`,
    );
  }
  const information = await lstat(resolved).catch((error) => {
    if (error?.code === "ENOENT") {
      throw new LifecycleError(
        "USER_SUPPLEMENT_ATTACHMENT_MISSING",
        `${label} is missing.`,
      );
    }
    throw error;
  });
  if (information.isSymbolicLink() || !information.isFile()) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_ATTACHMENT_INVALID",
      `${label} must be a regular file.`,
    );
  }
  const buffer = await readFile(resolved);
  if (
    buffer.byteLength !== attachment.byteLength
    || sha256(buffer) !== attachment.sha256
  ) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_ATTACHMENT_HASH_MISMATCH",
      `${label} no longer matches its archived identity.`,
    );
  }
  return attachment;
}

export async function validateUserSupplementArchive({
  attemptRoot,
  expectedIdentity,
  requireSealed = false,
  allowMissing = false,
}) {
  const supplementPath = path.join(attemptRoot, "USER_SUPPLEMENT.json");
  if (!(await exists(supplementPath))) {
    if (allowMissing) return null;
    throw new LifecycleError(
      "USER_SUPPLEMENT_MISSING",
      "USER_SUPPLEMENT.json is missing.",
    );
  }
  const archive = await readJson(supplementPath, "USER_SUPPLEMENT.json");
  assertSupplementObject(archive, "USER_SUPPLEMENT.json");
  assertSupplementKeys(archive, new Set([
    "schemaVersion",
    "status",
    "projectId",
    "documentId",
    "requestId",
    "attemptId",
    "records",
    "sealedAt",
    "recordsSha256",
    "attachmentsSha256",
  ]), "USER_SUPPLEMENT.json");
  if (archive.schemaVersion !== USER_SUPPLEMENT_SCHEMA_VERSION) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_SCHEMA_INVALID",
      "USER_SUPPLEMENT.json schemaVersion is not supported.",
    );
  }
  for (const field of ["projectId", "documentId", "requestId", "attemptId"]) {
    if (archive[field] !== expectedIdentity[field]) {
      throw new LifecycleError(
        "USER_SUPPLEMENT_IDENTITY_MISMATCH",
        `USER_SUPPLEMENT.json ${field} does not match the active Attempt.`,
      );
    }
  }
  if (!["active", "sealed"].includes(archive.status)) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_SCHEMA_INVALID",
      "USER_SUPPLEMENT.json status is invalid.",
    );
  }
  if (!Array.isArray(archive.records) || archive.records.length > MAX_SUPPLEMENT_RECORDS) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_SCHEMA_INVALID",
      "USER_SUPPLEMENT.json records is invalid.",
    );
  }
  const recordIds = new Set();
  const idempotencyKeys = new Set();
  const knownReferences = new Set(
    expectedIdentity.instructionIds ?? [],
  );
  let totalAttachmentBytes = 0;
  for (const [index, value] of archive.records.entries()) {
    const record = validateSupplementRecordShape(value, index);
    if (recordIds.has(record.recordId) || idempotencyKeys.has(record.idempotencyKey)) {
      throw new LifecycleError(
        "USER_SUPPLEMENT_DUPLICATE_RECORD",
        "Supplement record IDs and idempotency keys must be unique.",
      );
    }
    for (const reference of record.refersTo) {
      if (!knownReferences.has(reference)) {
        throw new LifecycleError(
          "USER_SUPPLEMENT_REFERENCE_NOT_FOUND",
          `Supplement reference ${reference} does not exist in this Request.`,
        );
      }
    }
    const attachmentIds = new Set();
    for (const [attachmentIndex, attachment] of record.attachments.entries()) {
      const validated = await validateSupplementAttachment(
        attemptRoot,
        attachment,
        `records[${index}].attachments[${attachmentIndex}]`,
      );
      if (attachmentIds.has(validated.attachmentId)) {
        throw new LifecycleError(
          "USER_SUPPLEMENT_DUPLICATE_ATTACHMENT",
          "Supplement attachment IDs must be unique within a record.",
        );
      }
      attachmentIds.add(validated.attachmentId);
      totalAttachmentBytes += validated.byteLength;
    }
    if (totalAttachmentBytes > MAX_SUPPLEMENT_TOTAL_ATTACHMENT_BYTES) {
      throw new LifecycleError(
        "USER_SUPPLEMENT_ATTACHMENT_LIMIT",
        "Supplement attachments exceed the 100 MB Attempt limit.",
      );
    }
    recordIds.add(record.recordId);
    idempotencyKeys.add(record.idempotencyKey);
    knownReferences.add(record.recordId);
  }
  const expectedRecordsSha256 = supplementRecordsSha256(archive.records);
  const expectedAttachmentsSha256 = supplementAttachmentsSha256(archive.records);
  if (archive.status === "sealed") {
    supplementTimestamp(archive.sealedAt, "USER_SUPPLEMENT.json sealedAt");
    supplementSha(archive.recordsSha256, "USER_SUPPLEMENT.json recordsSha256");
    supplementSha(
      archive.attachmentsSha256,
      "USER_SUPPLEMENT.json attachmentsSha256",
    );
    if (
      archive.recordsSha256 !== expectedRecordsSha256
      || archive.attachmentsSha256 !== expectedAttachmentsSha256
    ) {
      throw new LifecycleError(
        "USER_SUPPLEMENT_SEAL_MISMATCH",
        "USER_SUPPLEMENT.json changed after it was sealed.",
      );
    }
  } else if (
    archive.sealedAt !== null
    || archive.recordsSha256 !== null
    || archive.attachmentsSha256 !== null
  ) {
    throw new LifecycleError(
      "USER_SUPPLEMENT_SCHEMA_INVALID",
      "An active supplement archive cannot contain seal fields.",
    );
  }
  if (requireSealed && archive.status !== "sealed") {
    throw new LifecycleError(
      "USER_SUPPLEMENT_NOT_SEALED",
      "USER_SUPPLEMENT.json must be sealed before Version creation.",
    );
  }
  return {
    ...archive,
    path: supplementPath,
    recordCount: archive.records.length,
    activeRequirementCount: activeSupplementRequirementCount(archive.records),
  };
}

export async function sealUserSupplementForAttempt({
  attemptRoot,
  expectedIdentity,
}) {
  const supplementPath = path.join(attemptRoot, "USER_SUPPLEMENT.json");
  if (!(await exists(supplementPath))) {
    await atomicWriteJson(
      supplementPath,
      emptyUserSupplementArchive(expectedIdentity),
    );
  }
  const archive = await validateUserSupplementArchive({
    attemptRoot,
    expectedIdentity,
  });
  if (archive.status === "sealed") return archive;
  const sealed = {
    schemaVersion: archive.schemaVersion,
    status: "sealed",
    projectId: archive.projectId,
    documentId: archive.documentId,
    requestId: archive.requestId,
    attemptId: archive.attemptId,
    records: archive.records,
    sealedAt: nowIso(),
    recordsSha256: supplementRecordsSha256(archive.records),
    attachmentsSha256: supplementAttachmentsSha256(archive.records),
  };
  await atomicWriteJson(supplementPath, sealed);
  return validateUserSupplementArchive({
    attemptRoot,
    expectedIdentity,
    requireSealed: true,
  });
}

export async function recordUserSupplement({
  projectRoot,
  projectId,
  requestId,
  attemptId = "attempt_001",
  payload,
}) {
  assertProjectId(projectId);
  assertRequestId(requestId);
  assertAttemptId(attemptId);
  const resolvedProjectRoot = path.resolve(projectRoot);
  if (!(await exists(resolvedProjectRoot))) {
    throw new LifecycleError(
      "PROJECT_NOT_FOUND",
      `${projectId} was not found.`,
      undefined,
      404,
    );
  }
  const input = assertSupplementObject(payload, "supplement payload");
  assertSupplementKeys(input, new Set([
    "idempotencyKey",
    "action",
    "refersTo",
    "userText",
    "targetDescription",
    "evidenceState",
    "evidenceDescription",
    "attachments",
  ]), "supplement payload");

  return withProjectFileLock(resolvedProjectRoot, async () => {
    const project = await readVersionedJson(
      path.join(resolvedProjectRoot, "project.json"),
      "project.json",
      LIFECYCLE_SCHEMA_VERSION,
    );
    if (
      project?.projectId !== projectId
      || project.storageDirectoryName !== path.basename(resolvedProjectRoot)
    ) {
      throw new LifecycleError(
        "PROJECT_STORAGE_METADATA_MISMATCH",
        "project.json identity does not match the requested project directory.",
        undefined,
        409,
      );
    }
    const runtime = await readVersionedJson(
      path.join(resolvedProjectRoot, "runtime-state.json"),
      "runtime-state.json",
      LIFECYCLE_SCHEMA_VERSION,
    );
    const activeRun = runtime.activeRun;
    if (
      !activeRun
      || activeRun.requestId !== requestId
      || activeRun.attemptId !== attemptId
      || !["processing", "validating"].includes(runtime.lifecycleState)
    ) {
      throw new LifecycleError(
        "ATTEMPT_NOT_ACTIVE",
        "This Request and Attempt is no longer accepting conversation supplements.",
        undefined,
        409,
      );
    }
    const requestRoot = path.join(resolvedProjectRoot, "requests", requestId);
    const attemptRoot = path.join(requestRoot, "attempts", attemptId);
    for (const terminalName of ["completion.json", "cancelled.json", "outcome.json"]) {
      if (await exists(path.join(attemptRoot, terminalName))) {
        throw new LifecycleError(
          "USER_SUPPLEMENT_ATTEMPT_CLOSED",
          "This Attempt is already finalized. Start a new Request for further changes.",
          undefined,
          409,
        );
      }
    }
    const changeRequest = await readVersionedJson(
      path.join(requestRoot, "change-request.json"),
      "change-request.json",
      LIFECYCLE_SCHEMA_VERSION,
    );
    const instructionIds = (changeRequest.requirements?.instructions ?? [])
      .map((instruction) => instruction.instructionId)
      .filter((value) => typeof value === "string");
    const expectedIdentity = {
      projectId: project.projectId,
      documentId: project.documentId,
      requestId,
      attemptId,
      instructionIds,
    };
    const supplementPath = path.join(attemptRoot, "USER_SUPPLEMENT.json");
    if (!(await exists(supplementPath))) {
      await atomicWriteJson(
        supplementPath,
        emptyUserSupplementArchive(expectedIdentity),
      );
    }
    const archive = await validateUserSupplementArchive({
      attemptRoot,
      expectedIdentity,
    });
    if (archive.status !== "active") {
      throw new LifecycleError(
        "USER_SUPPLEMENT_ATTEMPT_CLOSED",
        "This Attempt has sealed its conversation supplements.",
        undefined,
        409,
      );
    }
    const idempotencyKey = supplementText(
      input.idempotencyKey,
      "idempotencyKey",
      180,
    );
    const action = input.action;
    if (!SUPPLEMENT_ACTIONS.has(action)) {
      throw new LifecycleError(
        "USER_SUPPLEMENT_SCHEMA_INVALID",
        "action must be add, amend, or retract.",
      );
    }
    const userText = supplementText(input.userText, "userText", 20_000);
    const targetDescription = supplementText(
      input.targetDescription,
      "targetDescription",
      4_000,
      { nullable: true },
    );
    const evidenceDescription = supplementText(
      input.evidenceDescription,
      "evidenceDescription",
      20_000,
      { nullable: true },
    );
    const rawReferences = input.refersTo ?? [];
    if (!Array.isArray(rawReferences) || rawReferences.length > 50) {
      throw new LifecycleError(
        "USER_SUPPLEMENT_SCHEMA_INVALID",
        "refersTo must be an array with at most 50 entries.",
      );
    }
    const refersTo = rawReferences.map((reference) => {
      if (typeof reference !== "string" || !SUPPLEMENT_REFERENCE_PATTERN.test(reference)) {
        throw new LifecycleError(
          "USER_SUPPLEMENT_SCHEMA_INVALID",
          "refersTo contains an invalid requirement ID.",
        );
      }
      return reference;
    });
    if (new Set(refersTo).size !== refersTo.length) {
      throw new LifecycleError(
        "USER_SUPPLEMENT_SCHEMA_INVALID",
        "refersTo cannot contain duplicate IDs.",
      );
    }
    if (["amend", "retract"].includes(action) && refersTo.length === 0) {
      throw new LifecycleError(
        "USER_SUPPLEMENT_REFERENCE_REQUIRED",
        `${action} requires at least one referenced requirement.`,
      );
    }
    const knownIds = new Set([
      ...instructionIds,
      ...archive.records.map((record) => record.recordId),
    ]);
    const unknownReference = refersTo.find((reference) => !knownIds.has(reference));
    if (unknownReference) {
      throw new LifecycleError(
        "USER_SUPPLEMENT_REFERENCE_NOT_FOUND",
        `Requirement ${unknownReference} was not found in this Request.`,
      );
    }
    const rawAttachments = input.attachments ?? [];
    if (!Array.isArray(rawAttachments) || rawAttachments.length > MAX_SUPPLEMENT_ATTACHMENTS) {
      throw new LifecycleError(
        "USER_SUPPLEMENT_ATTACHMENT_LIMIT",
        "A supplement may contain at most 10 attachments.",
      );
    }
    const existing = archive.records.find(
      (record) => record.idempotencyKey === idempotencyKey,
    );
    if (existing) {
      const requestedEvidenceState = input.evidenceState
        ?? (rawAttachments.length > 0 ? "original-file" : "text-only");
      const attachmentsMatch = existing.attachments.length === rawAttachments.length
        && await Promise.all(rawAttachments.map(async (rawValue, index) => {
          const raw = assertSupplementObject(rawValue, `attachments[${index}]`);
          assertSupplementKeys(raw, new Set(["path", "fileName"]), `attachments[${index}]`);
          const sourcePath = path.resolve(
            supplementText(raw.path, `attachments[${index}].path`, 4_000),
          );
          const buffer = await readFile(sourcePath).catch(() => null);
          if (!buffer) return false;
          const fileName = safeSupplementFileName(
            raw.fileName ?? path.basename(sourcePath),
          );
          return existing.attachments[index]?.fileName === fileName
            && existing.attachments[index]?.sha256 === sha256(buffer);
        })).then((matches) => matches.every(Boolean));
      if (
        existing.action !== action
        || existing.userText !== userText
        || JSON.stringify(existing.refersTo) !== JSON.stringify(refersTo)
        || existing.targetDescription !== targetDescription
        || existing.evidenceState !== requestedEvidenceState
        || existing.evidenceDescription !== evidenceDescription
        || !attachmentsMatch
      ) {
        throw new LifecycleError(
          "USER_SUPPLEMENT_IDEMPOTENCY_CONFLICT",
          "This idempotency key was already used for different supplement content.",
          undefined,
          409,
        );
      }
      return {
        ok: true,
        idempotent: true,
        recordId: existing.recordId,
        recordCount: archive.recordCount,
        activeRequirementCount: archive.activeRequirementCount,
        supplementPath,
      };
    }
    if (archive.records.length >= MAX_SUPPLEMENT_RECORDS) {
      throw new LifecycleError(
        "USER_SUPPLEMENT_RECORD_LIMIT",
        "This Attempt already contains the maximum number of supplements.",
      );
    }
    const nextOrdinal = archive.records.reduce((maximum, record) => (
      Math.max(maximum, Number.parseInt(record.recordId.split("_").at(-1), 10))
    ), 0) + 1;
    const recordId = `supplement_${String(nextOrdinal).padStart(4, "0")}`;
    const preparedAttachments = [];
    let attachmentBytes = 0;
    for (const [index, rawValue] of rawAttachments.entries()) {
      const raw = assertSupplementObject(rawValue, `attachments[${index}]`);
      assertSupplementKeys(raw, new Set(["path", "fileName"]), `attachments[${index}]`);
      const sourcePath = path.resolve(
        supplementText(raw.path, `attachments[${index}].path`, 4_000),
      );
      const information = await lstat(sourcePath).catch((error) => {
        if (error?.code === "ENOENT") {
          throw new LifecycleError(
            "USER_SUPPLEMENT_ATTACHMENT_MISSING",
            `Attachment ${sourcePath} was not found.`,
          );
        }
        throw error;
      });
      if (
        information.isSymbolicLink()
        || !information.isFile()
        || information.size < 1
        || information.size > MAX_SUPPLEMENT_ATTACHMENT_BYTES
      ) {
        throw new LifecycleError(
          "USER_SUPPLEMENT_ATTACHMENT_INVALID",
          "Supplement attachments must be regular files between 1 byte and 25 MB.",
        );
      }
      const buffer = await readFile(sourcePath);
      attachmentBytes += buffer.byteLength;
      if (attachmentBytes > MAX_SUPPLEMENT_TOTAL_ATTACHMENT_BYTES) {
        throw new LifecycleError(
          "USER_SUPPLEMENT_ATTACHMENT_LIMIT",
          "Supplement attachments exceed the 100 MB Attempt limit.",
        );
      }
      const fileName = safeSupplementFileName(
        raw.fileName ?? path.basename(sourcePath),
      );
      const attachmentId =
        `suppatt_${String(nextOrdinal).padStart(4, "0")}_${String(index + 1).padStart(2, "0")}`;
      const relativePath =
        `supplement-attachments/${attachmentId}-${fileName}`;
      preparedAttachments.push({
        attachmentId,
        fileName,
        mediaType: SUPPLEMENT_MEDIA_TYPES.get(path.extname(fileName).toLowerCase()),
        byteLength: buffer.byteLength,
        sha256: sha256(buffer),
        relativePath,
        buffer,
      });
    }
    const evidenceState = input.evidenceState
      ?? (preparedAttachments.length > 0 ? "original-file" : "text-only");
    if (!SUPPLEMENT_EVIDENCE_STATES.has(evidenceState)) {
      throw new LifecycleError(
        "USER_SUPPLEMENT_SCHEMA_INVALID",
        "evidenceState is invalid.",
      );
    }
    if (evidenceState === "description-only" && !evidenceDescription) {
      throw new LifecycleError(
        "USER_SUPPLEMENT_EVIDENCE_DESCRIPTION_REQUIRED",
        "description-only evidence must include evidenceDescription.",
      );
    }
    if (
      (preparedAttachments.length > 0) !== (evidenceState === "original-file")
    ) {
      throw new LifecycleError(
        "USER_SUPPLEMENT_EVIDENCE_STATE_MISMATCH",
        "original-file evidence and managed attachments must be provided together.",
      );
    }
    for (const attachment of preparedAttachments) {
      const destination = path.join(
        attemptRoot,
        ...attachment.relativePath.split("/"),
      );
      if (await exists(destination)) {
        const current = await readFile(destination);
        if (sha256(current) !== attachment.sha256) {
          throw new LifecycleError(
            "USER_SUPPLEMENT_ATTACHMENT_COLLISION",
            "A managed supplement attachment path already contains different content.",
          );
        }
      } else {
        await atomicWriteFile(destination, attachment.buffer);
      }
    }
    const record = {
      recordId,
      recordedAt: nowIso(),
      idempotencyKey,
      action,
      refersTo,
      userText,
      targetDescription,
      evidenceState,
      evidenceDescription,
      attachments: preparedAttachments.map((attachment) => ({
        attachmentId: attachment.attachmentId,
        fileName: attachment.fileName,
        mediaType: attachment.mediaType,
        byteLength: attachment.byteLength,
        sha256: attachment.sha256,
        relativePath: attachment.relativePath,
      })),
    };
    const updated = {
      schemaVersion: archive.schemaVersion,
      status: "active",
      projectId: archive.projectId,
      documentId: archive.documentId,
      requestId: archive.requestId,
      attemptId: archive.attemptId,
      records: [...archive.records, record],
      sealedAt: null,
      recordsSha256: null,
      attachmentsSha256: null,
    };
    await atomicWriteJson(supplementPath, updated);
    const verified = await validateUserSupplementArchive({
      attemptRoot,
      expectedIdentity,
    });
    return {
      ok: true,
      idempotent: false,
      recordId,
      recordCount: verified.recordCount,
      activeRequirementCount: verified.activeRequirementCount,
      supplementPath,
    };
  });
}

function outputRelativePathForAttempt(project, activeRun, changeRequest) {
  const outputRelativePath = changeRequest?.finalization?.outputRelativePath;
  if (
    typeof outputRelativePath !== "string"
    || !outputRelativePath.startsWith("output/")
    || outputRelativePath.includes("\0")
    || outputRelativePath.slice("output/".length).includes("/")
    || outputRelativePath.slice("output/".length).includes("\\")
  ) {
    throw new LifecycleError(
      "OUTPUT_PATH_IDENTITY_MISMATCH",
      "change-request.json declares an invalid Attempt output path.",
    );
  }
  const expectedActiveRunPath =
    `requests/${activeRun.requestId}/attempts/${activeRun.attemptId}/${outputRelativePath}`;
  if (activeRun.outputRelativePath !== expectedActiveRunPath) {
    throw new LifecycleError(
      "OUTPUT_PATH_IDENTITY_MISMATCH",
      "The active run output path does not match the frozen Request.",
      {
        expected: expectedActiveRunPath,
        actual: activeRun.outputRelativePath,
      },
    );
  }
  const expectedOutputRelativePath = `output/${workingCopyFileName(
    project.displayName,
    semanticVersionLabel(activeRun.candidateVersionOrdinal),
  )}`;
  if (outputRelativePath !== expectedOutputRelativePath) {
    throw new LifecycleError(
      "OUTPUT_PATH_IDENTITY_MISMATCH",
      "The frozen Request output path does not match its user filename and Version.",
      {
        expected: expectedOutputRelativePath,
        actual: outputRelativePath,
      },
    );
  }
  return outputRelativePath;
}

async function assertAttemptWriteSurface(attemptRoot, outputRelativePath) {
  const entries = await readdir(attemptRoot, { withFileTypes: true });
  const unexpected = findUnexpectedAttemptEntry(entries);
  if (unexpected) {
    throw new LifecycleError(
      "UNEXPECTED_ATTEMPT_OUTPUT",
      `Attempt contains unauthorized entry ${unexpected.name}.`,
    );
  }
  const supplementAttachments = path.join(
    attemptRoot,
    "supplement-attachments",
  );
  if (await exists(supplementAttachments)) {
    const information = await lstat(supplementAttachments);
    if (information.isSymbolicLink() || !information.isDirectory()) {
      throw new LifecycleError(
        "UNSAFE_SUPPLEMENT_ATTACHMENT_DIRECTORY",
        "supplement-attachments must be a real directory.",
      );
    }
  }
  const outputRoot = path.join(attemptRoot, "output");
  const outputInformation = await lstat(outputRoot);
  if (outputInformation.isSymbolicLink() || !outputInformation.isDirectory()) {
    throw new LifecycleError(
      "UNSAFE_OUTPUT_DIRECTORY",
      "Attempt output must be a real directory.",
    );
  }
  const outputEntries = await readdir(outputRoot, { withFileTypes: true });
  const unexpectedOutput = findUnexpectedAttemptOutputEntry(
    outputEntries,
    path.posix.basename(outputRelativePath),
  );
  if (unexpectedOutput) {
    throw new LifecycleError(
      "UNEXPECTED_OUTPUT_FILE",
      `Unexpected output file ${unexpectedOutput.name}.`,
    );
  }
}

function normalizeManifestRelativePath(value) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.includes("\0")
    || path.isAbsolute(value)
  ) {
    throw new LifecycleError(
      "INVALID_INPUT_MANIFEST_PATH",
      "input-manifest.json contains an invalid relative path.",
    );
  }
  const normalized = path.posix.normalize(value.replaceAll("\\", "/"));
  if (
    normalized === "."
    || normalized.startsWith("../")
    || normalized.includes("/../")
  ) {
    throw new LifecycleError(
      "INVALID_INPUT_MANIFEST_PATH",
      "input-manifest.json cannot reference a path outside the Request.",
    );
  }
  return normalized;
}

async function verifyFrozenInputManifest(requestRoot, activeRun) {
  const manifestPath = path.join(requestRoot, "input-manifest.json");
  const manifestBuffer = await readFile(manifestPath);
  let manifest;
  try {
    manifest = JSON.parse(manifestBuffer.toString("utf8"));
  } catch {
    throw new LifecycleError(
      "INVALID_INPUT_MANIFEST",
      "input-manifest.json is not valid JSON.",
    );
  }
  assertSchemaVersion(
    manifest,
    AUXILIARY_SCHEMA_VERSION,
    "input-manifest.json",
  );
  if (
    activeRun.inputManifestSha256
    && sha256(manifestBuffer) !== activeRun.inputManifestSha256
  ) {
    throw new LifecycleError(
      "INPUT_MANIFEST_HASH_MISMATCH",
      "The frozen input manifest has changed after Request publication.",
    );
  }
  const identityPairs = [
    ["projectId", activeRun.projectId],
    ["documentId", activeRun.documentId],
    ["requestId", activeRun.requestId],
    ["attemptId", activeRun.attemptId],
  ];
  for (const [key, expected] of identityPairs) {
    if (manifest[key] !== expected) {
      throw new LifecycleError(
        "INPUT_MANIFEST_IDENTITY_MISMATCH",
        `input-manifest.json ${key} does not match the active run.`,
      );
    }
  }
  if (manifest.frozen !== true || !Array.isArray(manifest.files)) {
    throw new LifecycleError(
      "INVALID_INPUT_MANIFEST",
      "input-manifest.json must declare a frozen files inventory.",
    );
  }
  const requiredPaths = new Set([
    "PROMPT.md",
    "input/AI_RULES.md",
    "input/PROJECT.md",
    "change-request.json",
    "input/base/index.html",
    "input/annotations/records.json",
  ]);
  const seen = new Set();
  for (const record of manifest.files) {
    const relativePath = normalizeManifestRelativePath(record?.path);
    if (seen.has(relativePath)) {
      throw new LifecycleError(
        "DUPLICATE_INPUT_MANIFEST_ENTRY",
        `input-manifest.json lists ${relativePath} more than once.`,
      );
    }
    seen.add(relativePath);
    const filePath = path.join(requestRoot, ...relativePath.split("/"));
    const information = await lstat(filePath).catch((error) => {
      if (error?.code === "ENOENT") {
        throw new LifecycleError(
          "FROZEN_INPUT_FILE_MISSING",
          `Frozen input ${relativePath} is missing.`,
        );
      }
      throw error;
    });
    if (information.isSymbolicLink() || !information.isFile()) {
      throw new LifecycleError(
        "UNSAFE_FROZEN_INPUT_FILE",
        `Frozen input ${relativePath} must be a regular file.`,
      );
    }
    const buffer = await readFile(filePath);
    if (
      record.byteLength !== buffer.byteLength
      || record.sha256 !== sha256(buffer)
    ) {
      throw new LifecycleError(
        "FROZEN_INPUT_HASH_MISMATCH",
        `Frozen input ${relativePath} no longer matches input-manifest.json.`,
      );
    }
  }
  for (const requiredPath of requiredPaths) {
    if (!seen.has(requiredPath)) {
      throw new LifecycleError(
        "FROZEN_INPUT_NOT_INVENTORIED",
        `input-manifest.json does not inventory ${requiredPath}.`,
      );
    }
  }
  if (!Array.isArray(manifest.readOrder)) {
    throw new LifecycleError(
      "INVALID_INPUT_MANIFEST",
      "input-manifest.json must declare an ordered AI read set.",
    );
  }
  const readPaths = new Set();
  for (const value of manifest.readOrder) {
    const relativePath = normalizeManifestRelativePath(value);
    if (readPaths.has(relativePath)) {
      throw new LifecycleError(
        "DUPLICATE_INPUT_READ_ENTRY",
        `input-manifest.json readOrder lists ${relativePath} more than once.`,
      );
    }
    if (!seen.has(relativePath)) {
      throw new LifecycleError(
        "UNINVENTORIED_INPUT_READ_ENTRY",
        `input-manifest.json readOrder references uninventoried input ${relativePath}.`,
      );
    }
    readPaths.add(relativePath);
  }
  for (const requiredPath of [
    "PROMPT.md",
    "input/AI_RULES.md",
    "change-request.json",
    "input/PROJECT.md",
    "input/base/index.html",
  ]) {
    if (!readPaths.has(requiredPath)) {
      throw new LifecycleError(
        "EXECUTION_INPUT_NOT_ORDERED",
        `input-manifest.json readOrder omits required execution input ${requiredPath}.`,
      );
    }
  }
  return { manifest, manifestSha256: sha256(manifestBuffer) };
}

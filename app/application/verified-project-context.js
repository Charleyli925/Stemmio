/** @typedef {import("./project-session.js").OpenTarget} OpenTarget */
/** @typedef {import("./project-session.js").ProjectContext} ProjectContext */
/** @typedef {Pick<import("./project-session.js").ProjectSession, "matches" | "epoch" | "sourcePath">} LiveProjectSession */
/**
 * @typedef {Object} VerifyProjectContextOptions
 * @property {boolean} [disposed]
 * @property {(left: string | null | undefined, right: string | null | undefined) => boolean} [sameSourcePath]
 */
/**
 * @typedef {Object} VerifyOpenTargetOptions
 * @property {string | null} [projectId]
 * @property {string | null} [documentId]
 * @property {string | null} [sourcePath]
 * @property {string | null} [sourceSha256]
 * @property {(left: string | null | undefined, right: string | null | undefined) => boolean} [sameSourcePath]
 * @property {OpenTarget["targetKind"] | null} [targetKind]
 */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** @param {unknown} value @returns {value is OpenTarget["targetKind"]} */
function isTargetKind(value) {
  return value === "working-copy" || value === "version";
}

/** @param {unknown} context @returns {ProjectContext | null} */
export function copyProjectContext(context) {
  if (!isRecord(context)) return null;
  const epoch = Number(context.epoch);
  const projectId = String(context.projectId || "");
  const documentId = String(context.documentId || "");
  const sourcePath = String(context.sourcePath || "");
  if (!Number.isSafeInteger(epoch) || !sourcePath) return null;

  /** @type {{ epoch: number, projectId: string, documentId: string, sourcePath: string }} */
  const base = { epoch, projectId, documentId, sourcePath };
  if (!context.projectRootPath || !context.targetKind) return Object.freeze(base);
  const targetKind = String(context.targetKind);
  if (!isTargetKind(targetKind)) return null;
  return Object.freeze({
    ...base,
    projectRootPath: String(context.projectRootPath),
    targetKind,
    workingCopyId: context.workingCopyId ? String(context.workingCopyId) : null,
    versionId: context.versionId ? String(context.versionId) : null,
    exactSourcePath: String(context.exactSourcePath || sourcePath),
    sourceSha256: String(context.sourceSha256 || ""),
    sessionEpoch: Number(context.sessionEpoch ?? epoch),
  });
}

/**
 * @param {unknown} candidate
 * @param {LiveProjectSession | null | undefined} live
 * @param {VerifyProjectContextOptions} [options]
 * @returns {ProjectContext | null}
 */
export function verifyProjectContext(candidate, live, {
  disposed = false,
  sameSourcePath = (left, right) => left === right,
} = {}) {
  if (disposed) return null;
  const context = copyProjectContext(candidate);
  if (!context || !live) return null;
  if (context.projectId && context.documentId) {
    return typeof live.matches === "function" && live.matches(context)
      ? context
      : null;
  }
  if (Number(live.epoch) !== context.epoch) return null;
  if (!sameSourcePath(live.sourcePath, context.sourcePath)) return null;
  return context;
}

const OPEN_TARGET_SHA256 = /^sha256:[a-f0-9]{64}$/u;

/**
 * Validate a complete managed OpenTarget without borrowing identity fields
 * from a surrounding workspace/request payload. Callers may provide a
 * verified source hash; when present it is an exact fence, never a fallback.
 * @param {unknown} target
 * @param {VerifyOpenTargetOptions} [options]
 * @returns {Readonly<Record<string, unknown>> | null}
 */
export function verifyOpenTarget(target, {
  projectId = null,
  documentId = null,
  sourcePath = null,
  sourceSha256 = null,
  sameSourcePath = (left, right) => left === right,
  targetKind = null,
} = {}) {
  if (!isRecord(target)) return null;
  if (
    !String(target.projectId || "")
    || !String(target.documentId || "")
    || !String(target.projectRootPath || "")
    || !["working-copy", "version"].includes(String(target.targetKind || ""))
    || (targetKind && String(target.targetKind) !== String(targetKind))
    || !String(target.exactSourcePath || "")
    || !OPEN_TARGET_SHA256.test(String(target.sourceSha256 || ""))
    || (projectId && String(target.projectId) !== String(projectId))
    || (documentId && String(target.documentId) !== String(documentId))
    || (sourcePath && !sameSourcePath(String(target.exactSourcePath), String(sourcePath)))
    || (sourceSha256 && String(target.sourceSha256) !== String(sourceSha256))
    || (String(target.targetKind) === "working-copy"
      && (!String(target.workingCopyId || "") || !String(target.versionId || "")))
    || (String(target.targetKind) === "version" && !String(target.versionId || ""))
  ) return null;
  return Object.freeze({ ...target });
}

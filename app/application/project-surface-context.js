import { verifyOpenTarget } from "./verified-project-context.js";

/** @typedef {import("./project-surface-context.js").ProjectSurfaceContext} ProjectSurfaceContext */

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const SHA256 = /^sha256:[a-f0-9]{64}$/u;

/** @param {unknown} value */
function comparableSurfacePath(value) {
  let sourcePath = String(value || "").normalize("NFC");
  if (sourcePath === "/private/var" || sourcePath.startsWith("/private/var/")) {
    sourcePath = sourcePath.slice("/private".length);
  } else if (sourcePath === "/private/tmp" || sourcePath.startsWith("/private/tmp/")) {
    sourcePath = sourcePath.slice("/private".length);
  }
  return sourcePath;
}

/** @param {unknown} left @param {unknown} right */
function sameSurfacePath(left, right) {
  return Boolean(
    left
    && right
    && comparableSurfacePath(left) === comparableSurfacePath(right),
  );
}

/** @param {unknown} value @returns {value is ProjectSurfaceContext} */
export function isProjectSurfaceContext(value) {
  if (!isRecord(value)) return false;
  const epoch = Number(value?.epoch);
  const sessionEpoch = Number(value?.sessionEpoch);
  return Boolean(
    String(value.surfaceContextId || "")
    && String(value.projectId || "")
    && String(value.documentId || "")
    && String(value.sourcePath || "")
    && Number.isSafeInteger(epoch)
    && epoch >= 0
    && Number.isSafeInteger(sessionEpoch)
    && sessionEpoch === epoch
    && SHA256.test(String(value.sourceSha256 || ""))
    && verifyOpenTarget(value, {
      projectId: String(value.projectId || ""),
      documentId: String(value.documentId || ""),
      sourcePath: String(value.sourcePath || ""),
      sourceSha256: String(value.sourceSha256 || ""),
      sameSourcePath: sameSurfacePath,
    }),
  );
}

/** @param {unknown} value @returns {ProjectSurfaceContext | null} */
export function copyProjectSurfaceContext(value) {
  if (!isProjectSurfaceContext(value)) return null;
  return Object.freeze({
    surfaceContextId: String(value.surfaceContextId),
    epoch: Number(value.epoch ?? value.sessionEpoch),
    projectId: String(value.projectId),
    documentId: String(value.documentId),
    sourcePath: String(value.sourcePath),
    projectRootPath: String(value.projectRootPath),
    targetKind: String(value.targetKind) === "version" ? "version" : "working-copy",
    workingCopyId: value.workingCopyId ? String(value.workingCopyId) : null,
    versionId: value.versionId ? String(value.versionId) : null,
    exactSourcePath: String(value.exactSourcePath),
    sourceSha256: String(value.sourceSha256),
    sessionEpoch: Number(value.sessionEpoch),
  });
}

/**
 * @param {{ transactionId?: string | null, project: unknown }} input
 * @returns {ProjectSurfaceContext | null}
 */
export function createProjectSurfaceContext({ transactionId, project }) {
  if (!isRecord(project)) return null;
  const projectId = String(project?.projectId || "");
  const documentId = String(project?.documentId || "");
  const sourcePath = String(project?.sourcePath || "");
  const sourceSha256 = String(project?.sha256 || project?.sourceSha256 || "");
  const openTarget = verifyOpenTarget(project?.openTarget || project, {
    projectId,
    documentId,
    sourcePath,
    sourceSha256,
    sameSourcePath: sameSurfacePath,
  });
  if (!projectId || !documentId || !sourcePath || !openTarget) return null;
  // Repository OpenTarget values intentionally have no renderer session epoch.
  // Detached read-only surfaces use epoch zero and are fenced by the immutable
  // surfaceContextId; live ProjectSession contexts retain their actual epoch.
  const surfaceEpoch = Number.isSafeInteger(Number(openTarget.sessionEpoch))
    ? Number(openTarget.sessionEpoch)
    : 0;
  const nonce = String(transactionId || "surface");
  return copyProjectSurfaceContext({
    ...openTarget,
    surfaceContextId: [
      "surface",
      nonce,
      projectId,
      documentId,
      surfaceEpoch,
      sourceSha256,
    ].join(":"),
    epoch: surfaceEpoch,
    projectId,
    documentId,
    sourcePath,
    sourceSha256,
    sessionEpoch: surfaceEpoch,
  });
}

/** @param {unknown} left @param {unknown} right */
export function sameProjectSurfaceContext(left, right) {
  const a = copyProjectSurfaceContext(left);
  const b = copyProjectSurfaceContext(right);
  return Boolean(a && b && a.surfaceContextId === b.surfaceContextId);
}

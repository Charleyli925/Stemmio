// Current Registry schema, write lock and project/manifest/runtime validators.
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import {
  atomicWriteFile,
  jsonText,
  syncDirectory,
} from "../lifecycle-core.mjs";

import {
  DOCUMENT_ID,
  HTML_EXTENSIONS,
  PROJECT_FILE_SCHEMA_VERSION,
  PROJECT_ID,
  SAFE_OPERATION_ID,
  SAFE_REQUEST_ID,
  SHA256,
  VERSION_ID,
  WORKING_COPY_ID,
} from "./constants.mjs";
import {
  ProjectFileRepositoryError,
} from "./errors.mjs";
import {
  assertFileIdentity,
  assertId,
  assertRealPathInsideProject,
  atomicWriteProjectJson,
  directoryInformation,
  ensureRelativePath,
  hasExactKeys,
  isObject,
  nowIso,
  readJsonFile,
  validStateTimestamp,
} from "./path-safety.mjs";
import {
  assertPreferredFileStem,
  topLevelHtmlRelativePath,
  versionId,
} from "./identity.mjs";
import {
  PROJECT_REGISTRY_LOCK_FILE_NAME,
} from "../../shared/project-storage-contract.mjs";

export const CURRENT_REGISTRY_WRITE_LOCK_DIRECTORY = PROJECT_REGISTRY_LOCK_FILE_NAME;

export const CURRENT_REGISTRY_WRITE_LOCK_WAIT_MS = 20;

export const CURRENT_REGISTRY_WRITE_LOCK_TIMEOUT_MS = 30_000;

export const CURRENT_REGISTRY_WRITE_LOCK_GRACE_MS = 10_000;

export const CURRENT_REGISTRY_WRITE_LOCK_OWNER_FILE = /^\.owner-([a-f0-9-]{36})\.json$/u;

export const CURRENT_REGISTRY_WRITE_LOCK_RETIRING_FILE =
  /^\.retiring-([a-f0-9-]{36})-([a-f0-9-]{36})\.json$/u;

export function emptyRegistry(clock) {
  return {
    schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    updatedAt: nowIso(clock),
    projects: {},
    pendingImports: {},
  };
}

export function localProcessIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    // EPERM still proves that a local process owns this PID.  Only ESRCH is
    // safe evidence that a crashed migration owner can no longer publish.
    return cause?.code !== "ESRCH";
  }
}

// A lock directory whose ownership cannot be resolved is not a held lock.  It is
// the residue of a process that died between `mkdir` and its owner write, of a
// retire that died between its two renames, or of an owner file whose bytes were
// damaged.  None of those shapes can ever become resolvable again, so without a
// bounded exit every future acquisition would fail busy forever and no restart
// would help.
//
// A lease read can also come back unresolved for a purely transient reason: a
// live owner may be mid-release or mid-retire while its marker is renamed.  The
// two cases are separated by age, not by shape — a transient rename completes in
// microseconds, while crash residue keeps the same unresolvable directory for as
// long as it exists.  Reclaim therefore requires the directory to be older than
// the grace period, and re-proves both the directory identity and the still
// unresolved lease immediately before moving it.
//
// Age deliberately ignores `ctimeMs`: inode metadata is bumped by unrelated
// touches (backup and indexing tools, `chmod`, `utimes`), so including it would
// let any such touch reset the age and restore the permanent-busy behavior this
// reclaim exists to remove.  Creation and content timestamps only move when this
// lock is actually created or written.

// A lock directory whose ownership cannot be resolved is not a held lock.  It is
// the residue of a process that died between `mkdir` and its owner write, of a
// retire that died between its two renames, or of an owner file whose bytes were
// damaged.  None of those shapes can ever become resolvable again, so without a
// bounded exit every future acquisition would fail busy forever and no restart
// would help.
//
// A lease read can also come back unresolved for a purely transient reason: a
// live owner may be mid-release or mid-retire while its marker is renamed.  The
// two cases are separated by age, not by shape — a transient rename completes in
// microseconds, while crash residue keeps the same unresolvable directory for as
// long as it exists.  Reclaim therefore requires the directory to be older than
// the grace period, and re-proves both the directory identity and the still
// unresolved lease immediately before moving it.
//
// Age deliberately ignores `ctimeMs`: inode metadata is bumped by unrelated
// touches (backup and indexing tools, `chmod`, `utimes`), so including it would
// let any such touch reset the age and restore the permanent-busy behavior this
// reclaim exists to remove.  Creation and content timestamps only move when this
// lock is actually created or written.
export async function reclaimUnresolvableLockDirectory({
  projectsRoot,
  lockPath,
  label,
  observed,
  readLease,
  graceMs,
  now = Date.now,
  onBeforeReclaim = null,
}) {
  const lastActivityMs = Math.max(
    Number(observed?.birthtimeMs || 0),
    Number(observed?.mtimeMs || 0),
  );
  if (!lastActivityMs || now() - lastActivityMs <= graceMs) return false;

  const current = await directoryInformation(lockPath, label, {
    projectRootPath: projectsRoot,
  });
  if (!current) return false;
  // A replacement lock created at the same path is a different directory.
  if (
    String(current.dev) !== String(observed.dev)
    || String(current.ino) !== String(observed.ino)
  ) return false;
  // A mid-flight release or retire may have completed since the first read.
  if (await readLease()) return false;

  await onBeforeReclaim?.({ lockPath, lastActivityMs });
  const abandonedPath = path.join(
    projectsRoot,
    `.stemmio-lock-unresolvable-${randomUUID()}`,
  );
  try {
    await rename(lockPath, abandonedPath);
  } catch (cause) {
    if (cause?.code === "ENOENT") return false;
    throw cause;
  }
  await rm(abandonedPath, { recursive: true, force: true });
  await syncDirectory(projectsRoot);
  return true;
}

export function currentRegistryWriteLockPath(projectsRoot) {
  return path.join(projectsRoot, CURRENT_REGISTRY_WRITE_LOCK_DIRECTORY);
}

export function currentRegistryWriteLockOwnerPath(lockPath, token) {
  return path.join(lockPath, `.owner-${token}.json`);
}

export function currentRegistryWriteLockRetiringPath(lockPath, ownerToken) {
  return path.join(lockPath, `.retiring-${ownerToken}-${randomUUID()}.json`);
}

export function currentRegistryWriteLockMarker(name) {
  const owner = String(name || "").match(CURRENT_REGISTRY_WRITE_LOCK_OWNER_FILE);
  if (owner) return { ownerToken: owner[1] };
  const retiring = String(name || "").match(CURRENT_REGISTRY_WRITE_LOCK_RETIRING_FILE);
  if (retiring) return { ownerToken: retiring[1] };
  return null;
}

export function currentRegistryWriteLockOwner(value) {
  if (
    !hasExactKeys(value, ["createdAt", "pid", "token"])
    || !Number.isSafeInteger(value.pid)
    || value.pid < 1
    || typeof value.token !== "string"
    || !/^[a-f0-9-]{36}$/u.test(value.token)
    || !value.createdAt
    || Number.isNaN(Date.parse(value.createdAt))
  ) return null;
  return value;
}

export async function currentRegistryWriteLockLease({ projectsRoot, lockPath }) {
  let entries;
  try {
    entries = await readdir(lockPath, { withFileTypes: true });
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    throw cause;
  }
  const markers = entries
    .filter((entry) => entry.isFile())
    .map((entry) => ({ name: entry.name, marker: currentRegistryWriteLockMarker(entry.name) }))
    .filter((entry) => entry.marker);
  if (markers.length !== 1) return null;
  const marker = markers[0];
  const ownerPath = path.join(lockPath, marker.name);
  let ownerRecord;
  try {
    ownerRecord = await readJsonFile(
      ownerPath,
      "current Registry write lock",
      { projectRootPath: projectsRoot },
    );
  } catch (cause) {
    if (
      cause?.code === "ENOENT"
      || (
        cause instanceof ProjectFileRepositoryError
        && cause.code === "INVALID_JSON"
      )
    ) return null;
    throw cause;
  }
  const owner = currentRegistryWriteLockOwner(ownerRecord);
  if (!owner || owner.token !== marker.marker.ownerToken) return null;
  return { owner, ownerPath };
}

export async function releaseCurrentRegistryWriteLock({
  projectsRoot,
  lockPath,
  token,
}) {
  try {
    const ownerPath = currentRegistryWriteLockOwnerPath(lockPath, token);
    const owner = currentRegistryWriteLockOwner(await readJsonFile(
      ownerPath,
      "current Registry write lock",
      { projectRootPath: projectsRoot },
    ));
    if (!owner || owner.token !== token) return;
    await unlink(ownerPath).catch((cause) => {
      if (cause?.code !== "ENOENT") throw cause;
    });
    await rmdir(lockPath).catch((cause) => {
      if (cause?.code !== "ENOENT" && cause?.code !== "ENOTEMPTY") throw cause;
    });
    await syncDirectory(projectsRoot);
  } catch {
    // Releasing is cleanup, never authority. The published Registry is already
    // the authoritative fact, and this lock grants nothing to a later reader, so
    // a failed release must not become the outcome of an operation that already
    // committed. Raising here would replace a successful result, or replace the
    // original error whose code drives recovery, with a message about a lock
    // file. An inert directory left behind is reclaimed on age by
    // acquireCurrentRegistryWriteLock.
  }
}

export async function retireCurrentRegistryWriteLock({
  projectsRoot,
  lockPath,
  ownerPath,
  ownerToken,
}) {
  const retiringPath = currentRegistryWriteLockRetiringPath(lockPath, ownerToken);
  try {
    await rename(ownerPath, retiringPath);
  } catch (cause) {
    if (cause?.code === "ENOENT") return false;
    throw cause;
  }
  const abandonedPath = path.join(
    projectsRoot,
    `.stemmio-registry-write-stale-${randomUUID()}`,
  );
  try {
    await rename(lockPath, abandonedPath);
  } catch (cause) {
    if (cause?.code === "ENOENT") return false;
    throw cause;
  }
  await rm(abandonedPath, { recursive: true, force: true });
  await syncDirectory(projectsRoot);
  return true;
}

export function waitForCurrentRegistryWriteLock() {
  return new Promise((resolve) => {
    setTimeout(resolve, CURRENT_REGISTRY_WRITE_LOCK_WAIT_MS);
  });
}

export async function acquireCurrentRegistryWriteLock({
  projectsRoot,
  timeoutMs = CURRENT_REGISTRY_WRITE_LOCK_TIMEOUT_MS,
  graceMs = CURRENT_REGISTRY_WRITE_LOCK_GRACE_MS,
  now = Date.now,
  onBeforeRetire = null,
}) {
  const lockPath = currentRegistryWriteLockPath(projectsRoot);
  const deadlineAt = Date.now() + timeoutMs;

  while (true) {
    try {
      await assertRealPathInsideProject(projectsRoot, lockPath, "current Registry write lock");
    } catch (cause) {
      if (cause?.code !== "ENOENT") throw cause;
      // The lock may have disappeared after path-safety lstat() observed it
      // and before its realpath() completed.  A legal release/retire owns this
      // narrow race; retry the same bounded acquisition loop after proving the
      // Projects root itself still exists.  Missing roots remain an error, and
      // the next iteration re-runs the full symlink/path check.
      if (!await directoryInformation(projectsRoot, "Projects root")) throw cause;
      if (Date.now() >= deadlineAt) {
        throw new ProjectFileRepositoryError(
          "REGISTRY_BUSY",
          "The project Registry is occupied. A lock left behind by an interrupted Stemmio process is reclaimed automatically after a short grace period.",
        );
      }
      await waitForCurrentRegistryWriteLock();
      continue;
    }
    try {
      await mkdir(lockPath, { mode: 0o700 });
      await assertRealPathInsideProject(
        projectsRoot,
        lockPath,
        "current Registry write lock",
        { expectedKind: "directory" },
      );
      const token = randomUUID();
      const ownerPath = currentRegistryWriteLockOwnerPath(lockPath, token);
      await atomicWriteFile(ownerPath, Buffer.from(jsonText({
        pid: process.pid,
        token,
        createdAt: new Date().toISOString(),
      }), "utf8"), { mode: 0o600 });
      await Promise.all([
        syncDirectory(lockPath),
        syncDirectory(projectsRoot),
      ]);
      return () => releaseCurrentRegistryWriteLock({
        projectsRoot,
        lockPath,
        token,
      });
    } catch (cause) {
      if (cause?.code !== "EEXIST") throw cause;
    }

    const lockInformation = await directoryInformation(
      lockPath,
      "current Registry write lock",
      { projectRootPath: projectsRoot },
    );
    if (!lockInformation) continue;
    const lease = await currentRegistryWriteLockLease({ projectsRoot, lockPath });
    if (lease && !localProcessIsAlive(lease.owner.pid)) {
      await onBeforeRetire?.({
        lockPath,
        ownerPath: lease.ownerPath,
        owner: lease.owner,
      });
      await retireCurrentRegistryWriteLock({
        projectsRoot,
        lockPath,
        ownerPath: lease.ownerPath,
        ownerToken: lease.owner.token,
      });
      continue;
    }
    if (!lease && await reclaimUnresolvableLockDirectory({
      projectsRoot,
      lockPath,
      label: "current Registry write lock",
      observed: lockInformation,
      readLease: () => currentRegistryWriteLockLease({ projectsRoot, lockPath }),
      graceMs,
      now,
      onBeforeReclaim: (details) => onBeforeRetire?.({
        ...details,
        ownerPath: null,
        owner: null,
      }),
    })) continue;
    if (Date.now() >= deadlineAt) {
      throw new ProjectFileRepositoryError(
        "REGISTRY_BUSY",
        "The project Registry is occupied. A lock left behind by an interrupted Stemmio process is reclaimed automatically after a short grace period.",
      );
    }
    await waitForCurrentRegistryWriteLock();
  }
}

export function assertRegistryTimestamp(value, label) {
  if (!value || Number.isNaN(Date.parse(value))) {
    throw new ProjectFileRepositoryError(
      "INVALID_REGISTRY",
      label + " must be an RFC 3339 timestamp.",
    );
  }
  return value;
}

// Forward compatibility. A Registry record whose required members are missing
// or invalid is still an unrecognized shape and still fails closed, because
// reading a shape we cannot explain and then rewriting it is the destructive
// case. A record that carries every required member plus a member a newer
// Stemmio added is fully explainable: it is validated normally and returned
// unchanged, so read -> modify -> write never deletes the newer member.

// Forward compatibility. A Registry record whose required members are missing
// or invalid is still an unrecognized shape and still fails closed, because
// reading a shape we cannot explain and then rewriting it is the destructive
// case. A record that carries every required member plus a member a newer
// Stemmio added is fully explainable: it is validated normally and returned
// unchanged, so read -> modify -> write never deletes the newer member.
export function assertRegistryProjectRecord(projectId, record) {
  if (
    !isObject(record)
    || typeof record.registeredProjectRootPath !== "string"
    || !path.isAbsolute(record.registeredProjectRootPath)
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_REGISTRY",
      "The registered project root record is invalid.",
      { projectId },
    );
  }
  assertFileIdentity(record.rootFileIdentity, "registered rootFileIdentity");
  assertRegistryTimestamp(record.updatedAt, "registered root updatedAt");
  if (
    Object.hasOwn(record, "importSourceKey") !== Object.hasOwn(record, "importSourceSha256")
    || (
      Object.hasOwn(record, "importSourceKey")
      && (
        !SHA256.test(String(record.importSourceKey || ""))
        || !SHA256.test(String(record.importSourceSha256 || ""))
      )
    )
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_REGISTRY",
      "The registered import provenance is invalid.",
      { projectId },
    );
  }
  return record;
}

// Same forward-compatibility rule as assertRegistryProjectRecord.

// Same forward-compatibility rule as assertRegistryProjectRecord.
export function assertPendingImportRecord(projectId, record) {
  if (
    !isObject(record)
    || record.projectId !== projectId
    || typeof record.registeredProjectRootPath !== "string"
    || !path.isAbsolute(record.registeredProjectRootPath)
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_REGISTRY",
      "The pending import record is invalid.",
      { projectId },
    );
  }
  assertId(record.projectId, PROJECT_ID, "pending import projectId");
  assertId(record.documentId, DOCUMENT_ID, "pending import documentId");
  assertRegistryTimestamp(record.createdAt, "pending import createdAt");
  if (
    Object.hasOwn(record, "importSourceKey") !== Object.hasOwn(record, "importSourceSha256")
    || (
      Object.hasOwn(record, "importSourceKey")
      && (
        !SHA256.test(String(record.importSourceKey || ""))
        || !SHA256.test(String(record.importSourceSha256 || ""))
      )
    )
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_REGISTRY",
      "The pending import provenance is invalid.",
      { projectId },
    );
  }
  return record;
}

export function assertRegistry(registry) {
  if (
    !isObject(registry)
    || registry.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
    || !isObject(registry.projects)
    || !isObject(registry.pendingImports)
  ) {
    throw new ProjectFileRepositoryError(
      "UNSUPPORTED_REGISTRY_SCHEMA",
      "The project Registry uses an unsupported schema.",
    );
  }
  assertRegistryTimestamp(registry.updatedAt, "Registry updatedAt");
  for (const [projectId, record] of Object.entries(registry.projects)) {
    assertId(projectId, PROJECT_ID, "Registry projectId");
    assertRegistryProjectRecord(projectId, record);
  }
  for (const [projectId, record] of Object.entries(registry.pendingImports)) {
    assertId(projectId, PROJECT_ID, "pending import projectId");
    assertPendingImportRecord(projectId, record);
  }
  return registry;
}

export function assertProjectIdentity(project) {
  if (!isObject(project) || project.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION) {
    throw new ProjectFileRepositoryError(
      "UNSUPPORTED_PROJECT_SCHEMA",
      "project.json is not a supported Stemmio project identity.",
    );
  }
  assertId(project.projectId, PROJECT_ID, "projectId");
  assertId(project.documentId, DOCUMENT_ID, "documentId");
  if (!project.createdAt || Number.isNaN(Date.parse(project.createdAt))) {
    throw new ProjectFileRepositoryError("INVALID_PROJECT_IDENTITY", "project.json has no valid createdAt.");
  }
  return project;
}

export function assertManifest(manifest, project) {
  if (!isObject(manifest) || manifest.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION) {
    throw new ProjectFileRepositoryError(
      "UNSUPPORTED_MANIFEST_SCHEMA",
      "manifest.json is not a supported Stemmio manifest.",
    );
  }
  if (
    manifest.projectId !== project.projectId
    || manifest.documentId !== project.documentId
    || !Array.isArray(manifest.versions)
    || !Array.isArray(manifest.workingCopies)
  ) {
    throw new ProjectFileRepositoryError(
      "MANIFEST_IDENTITY_MISMATCH",
      "manifest.json does not match project.json.",
    );
  }
  const versionIds = new Set();
  for (const version of manifest.versions) {
    if (!isObject(version)) {
      throw new ProjectFileRepositoryError("INVALID_MANIFEST", "A Version entry is invalid.");
    }
    assertId(version.versionId, VERSION_ID, "versionId");
    if (
      !Number.isSafeInteger(version.ordinal)
      || version.ordinal < 1
      || version.versionId !== versionId(version.ordinal)
      || versionIds.has(version.versionId)
      || !SHA256.test(String(version.contentSha256 || ""))
    ) {
      throw new ProjectFileRepositoryError("INVALID_MANIFEST", "A Version entry is inconsistent.");
    }
    versionIds.add(version.versionId);
    ensureRelativePath(version.snapshotRelativePath, "snapshotRelativePath");
  }
  if (!versionIds.has(manifest.latestOfficialVersionId)) {
    throw new ProjectFileRepositoryError("INVALID_MANIFEST", "latestOfficialVersionId is unknown.");
  }
  const historyOperations = new Set();
  for (const version of manifest.versions) {
    if (version.sourceType !== undefined && !["initial", "internal-ai", "history-copy", "local-save", "recovery-copy"].includes(version.sourceType)) {
      throw new ProjectFileRepositoryError("INVALID_MANIFEST", "Unknown Version source type.");
    }
    if (!["history-copy", "local-save", "recovery-copy"].includes(version.sourceType)) continue;
    const basedOn = manifest.versions.find((v) => v.versionId === version.basedOnVersionId);
    const previous = manifest.versions.find((v) => v.versionId === version.previousVersionId);
    if (!SAFE_OPERATION_ID.test(String(version.sourceOperationId || "")) || historyOperations.has(version.sourceOperationId)
      || !basedOn || basedOn.ordinal >= version.ordinal || (version.sourceType === "history-copy" && basedOn.contentSha256 !== version.contentSha256)
      || !previous || previous.ordinal + 1 !== version.ordinal
      || version.sourceRequestId !== null || version.sourceCandidateId !== null) {
      throw new ProjectFileRepositoryError("INVALID_MANIFEST", "Historical creation provenance is inconsistent.");
    }
    historyOperations.add(version.sourceOperationId);
  }
  if (manifest.currentDraftSchemaVersion !== "1.0.0" || manifest.workingCopies.length !== 1) {
    throw new ProjectFileRepositoryError("INVALID_MANIFEST", "A current-draft project has exactly one editable member.");
  }
  if (Object.hasOwn(manifest, "retiredWorkingCopies")) {
    throw new ProjectFileRepositoryError("INVALID_MANIFEST", "Retired Working Copies are not supported.");
  }
  const workingCopyIds = new Set();
  const workingCopyPaths = new Set();
  for (const workingCopy of manifest.workingCopies) {
      if (!isObject(workingCopy)) {
        throw new ProjectFileRepositoryError("INVALID_MANIFEST", "A Working Copy entry is invalid.");
      }
      assertId(workingCopy.workingCopyId, WORKING_COPY_ID, "workingCopyId");
      if (
        workingCopyIds.has(workingCopy.workingCopyId)
        || !versionIds.has(workingCopy.basedOnVersionId)
        || !versionIds.has(workingCopy.versionId)
      ) {
        throw new ProjectFileRepositoryError("INVALID_MANIFEST", "A Working Copy entry is inconsistent.");
      }
      const sourceRelativePath = topLevelHtmlRelativePath(
        workingCopy.sourceRelativePath,
        "sourceRelativePath",
      );
      if (workingCopyPaths.has(sourceRelativePath)) {
        throw new ProjectFileRepositoryError(
          "INVALID_MANIFEST",
          "Working Copy source paths must be unique.",
        );
      }
      workingCopyPaths.add(sourceRelativePath);
      assertPreferredFileStem(workingCopy.preferredFileStem);
      if (!HTML_EXTENSIONS.has(String(workingCopy.preferredExtension || "").toLowerCase())) {
        throw new ProjectFileRepositoryError(
          "INVALID_MANIFEST",
          "A Working Copy preferred extension is invalid.",
        );
      }
      ensureRelativePath(workingCopy.stateRelativePath, "stateRelativePath");
      assertFileIdentity(workingCopy.fileIdentity, "Working Copy fileIdentity");
      workingCopyIds.add(workingCopy.workingCopyId);
  }
  return manifest;
}

export function assertLastAiTask(runtime, project, manifest) {
  const task = runtime.lastAiTask;
  if (task === undefined || task === null) return null;
  if (
    !hasExactKeys(task, [
      "attemptId",
      "candidateId",
      "completedAt",
      "documentId",
      "expectedSourceSha256",
      "inputManifestSha256",
      "projectId",
      "requestId",
      "sourceWorkingCopyId",
      "status",
    ])
    || task.projectId !== project.projectId
    || task.documentId !== project.documentId
    || !SAFE_REQUEST_ID.test(String(task.requestId || ""))
    || !SAFE_REQUEST_ID.test(String(task.attemptId || ""))
    || !/^candidate_[A-Za-z0-9_-]{8,160}$/u.test(String(task.candidateId || ""))
    || !WORKING_COPY_ID.test(String(task.sourceWorkingCopyId || ""))
    || !SHA256.test(String(task.expectedSourceSha256 || ""))
    || !SHA256.test(String(task.inputManifestSha256 || ""))
    || !["no-change", "error"].includes(task.status)
    || !validStateTimestamp(task.completedAt)
    || !manifest.workingCopies.some(
      (workingCopy) => workingCopy.workingCopyId === task.sourceWorkingCopyId,
    )
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_RUNTIME",
      "lastAiTask is inconsistent.",
    );
  }
  return task;
}

export function lastAiTaskAnchorFor(record) {
  return {
    requestId: record.requestId,
    attemptId: record.attemptId,
    candidateId: record.candidateId,
    projectId: record.projectId,
    documentId: record.documentId,
    sourceWorkingCopyId: record.sourceWorkingCopyId,
    expectedSourceSha256: record.expectedSourceSha256,
    inputManifestSha256: record.inputManifestSha256,
    status: record.status,
    completedAt: record.completedAt,
  };
}

export async function writeRuntimeState(projectRootPath, runtimePath, runtime) {
  await atomicWriteProjectJson(
    projectRootPath,
    runtimePath,
    runtime,
    "runtime-state.json",
  );
  return runtime;
}

export function assertRuntime(runtime, project, manifest) {
  if (!isObject(runtime) || runtime.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION) {
    throw new ProjectFileRepositoryError(
      "UNSUPPORTED_RUNTIME_SCHEMA",
      "runtime-state.json is not a supported Stemmio runtime state.",
    );
  }
  if (Object.hasOwn(runtime, "historyActivation")) {
    throw new ProjectFileRepositoryError(
      "UNSUPPORTED_RUNTIME_FORMAT",
      "runtime-state.json contains an unsupported history activation receipt.",
    );
  }
  if (runtime.projectId !== project.projectId || runtime.documentId !== project.documentId) {
    throw new ProjectFileRepositoryError(
      "RUNTIME_IDENTITY_MISMATCH",
      "runtime-state.json does not match project.json.",
    );
  }
  if (
    runtime.activeWorkingCopyId !== null
    && !manifest.workingCopies.some(
      (workingCopy) => workingCopy.workingCopyId === runtime.activeWorkingCopyId,
    )
  ) {
    throw new ProjectFileRepositoryError("INVALID_RUNTIME", "activeWorkingCopyId is unknown.");
  }
  if (
    (runtime.activeRequest !== null && runtime.activeWorkingCopyId === null)
    || (runtime.activeRequest === null && runtime.activeCandidateId !== null)
  ) {
    throw new ProjectFileRepositoryError(
      "INVALID_RUNTIME",
      "active Request runtime anchors are inconsistent.",
    );
  }
  if (runtime.historyCreation != null) {
    const creation = runtime.historyCreation;
    const version = manifest.versions.find((v) => v.versionId === creation?.versionId);
    if (!isObject(creation) || !SAFE_OPERATION_ID.test(String(creation.operationId || ""))
      || version?.sourceType !== "history-copy" || version.sourceOperationId !== creation.operationId) {
      throw new ProjectFileRepositoryError("INVALID_RUNTIME", "Historical creation receipt is inconsistent.");
    }
  }
  if (runtime.activeRequest !== null) {
    const active = runtime.activeRequest;
    if (
      !isObject(active)
      || !SAFE_REQUEST_ID.test(active.requestId)
      || !SAFE_REQUEST_ID.test(active.attemptId)
      || !["processing", "pending-review"].includes(active.status)
      || (active.candidateId !== null && !/^candidate_[A-Za-z0-9_-]{8,160}$/u.test(active.candidateId))
      || (
        active.inputManifestSha256 !== null
        && !SHA256.test(String(active.inputManifestSha256 || ""))
      )
      || (
        active.candidateOutputSha256 !== null
        && !SHA256.test(String(active.candidateOutputSha256 || ""))
      )
      || (
        active.candidateRecordSha256 !== null
        && !SHA256.test(String(active.candidateRecordSha256 || ""))
      )
      || (active.status === "processing" && !SHA256.test(String(active.inputManifestSha256 || "")))
      || (
        active.status === "processing"
        && (
          active.candidateId !== null
          || active.candidateOutputSha256 !== null
          || active.candidateRecordSha256 !== null
        )
      )
      || (
        active.status === "pending-review"
        && (
          active.candidateId !== runtime.activeCandidateId
          || !SHA256.test(String(active.candidateOutputSha256 || ""))
          || !SHA256.test(String(active.candidateRecordSha256 || ""))
        )
      )
    ) {
      throw new ProjectFileRepositoryError("INVALID_RUNTIME", "active Request is inconsistent.");
    }
  }
  const lastAiTask = assertLastAiTask(runtime, project, manifest);
  if (runtime.activeRequest !== null && lastAiTask !== null) {
    throw new ProjectFileRepositoryError(
      "INVALID_RUNTIME",
      "An active Request cannot retain a terminal AI task anchor.",
    );
  }
  return runtime;
}

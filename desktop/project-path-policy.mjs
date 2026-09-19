import path from "node:path";

const PROJECT_ID_PATTERN = /^project_[A-Za-z0-9_-]+$/;
const VERSION_ID_PATTERN = /^ver_\d{4,}$/;
const READABLE_STORAGE_SUFFIX_PATTERN =
  /__(\d{8}-\d{6})__([a-f0-9]{8,32})$/;

export function isActiveProjectIdentity({
  requestedIdentity,
  activeIdentity,
}) {
  return Boolean(
    typeof requestedIdentity === "string"
    && requestedIdentity
    && requestedIdentity === activeIdentity
  );
}

export function isManagedProjectStorageDirectory(
  storageDirectoryName,
  projectId,
) {
  if (
    typeof storageDirectoryName !== "string"
    || !storageDirectoryName
    || path.basename(storageDirectoryName) !== storageDirectoryName
    || !PROJECT_ID_PATTERN.test(projectId)
  ) return false;
  const match = storageDirectoryName.match(READABLE_STORAGE_SUFFIX_PATTERN);
  return Boolean(
    match
    && projectId.slice("project_".length).toLowerCase().startsWith(match[2])
  );
}

export function isManagedVersionRelativePath(relativePath, {
  projectId,
  storageDirectoryName,
  versionId,
}) {
  if (
    typeof relativePath !== "string"
    || !relativePath
    || path.isAbsolute(relativePath)
    || !VERSION_ID_PATTERN.test(versionId)
    || !isManagedProjectStorageDirectory(storageDirectoryName, projectId)
  ) return false;
  const parts = relativePath.split(path.sep);
  return Boolean(
    parts.length === 6
    && parts[0] === "projects"
    && parts[1] === storageDirectoryName
    && parts[2] === "versions"
    && parts[3] === versionId
    && parts[4] === "files"
    && parts[5] === "index.html"
  );
}

import assert from "node:assert/strict";
import test from "node:test";

import {
  isActiveProjectIdentity,
  isManagedProjectStorageDirectory,
  isManagedVersionRelativePath,
} from "../desktop/project-path-policy.mjs";

const PROJECT_ID = "project_0123456789abcdef";
const VERSION_ID = "ver_0007";
const READABLE_DIRECTORY = "季度报告__20260728-090102__01234567";

test("source rename authorization accepts only the active physical file identity", () => {
  assert.equal(isActiveProjectIdentity({
    requestedIdentity: "2049:1001",
    activeIdentity: "2049:1001",
  }), true);
  assert.equal(isActiveProjectIdentity({
    requestedIdentity: "2049:1002",
    activeIdentity: "2049:1001",
  }), false);
  assert.equal(isActiveProjectIdentity({
    requestedIdentity: null,
    activeIdentity: "2049:1001",
  }), false);
});

test("history reveal accepts only current readable project directories", () => {
  assert.equal(
    isManagedProjectStorageDirectory(READABLE_DIRECTORY, PROJECT_ID),
    true,
  );
  assert.equal(
    isManagedVersionRelativePath(
      `projects/${READABLE_DIRECTORY}/versions/${VERSION_ID}/files/index.html`,
      {
        projectId: PROJECT_ID,
        storageDirectoryName: READABLE_DIRECTORY,
        versionId: VERSION_ID,
      },
    ),
    true,
  );
  assert.equal(
    isManagedVersionRelativePath(
      `projects/${PROJECT_ID}/versions/${VERSION_ID}/files/index.html`,
      {
        projectId: PROJECT_ID,
        storageDirectoryName: PROJECT_ID,
        versionId: VERSION_ID,
      },
    ),
    false,
  );
});

test("history reveal rejects mismatched storage identities and path traversal", () => {
  const mismatchedDirectory = "季度报告__20260728-090102__fedcba98";
  assert.equal(
    isManagedProjectStorageDirectory(mismatchedDirectory, PROJECT_ID),
    false,
  );
  assert.equal(
    isManagedVersionRelativePath(
      `projects/${mismatchedDirectory}/versions/${VERSION_ID}/files/index.html`,
      {
        projectId: PROJECT_ID,
        storageDirectoryName: mismatchedDirectory,
        versionId: VERSION_ID,
      },
    ),
    false,
  );
  assert.equal(
    isManagedVersionRelativePath(
      `projects/${READABLE_DIRECTORY}/versions/${VERSION_ID}/files/../index.html`,
      {
        projectId: PROJECT_ID,
        storageDirectoryName: READABLE_DIRECTORY,
        versionId: VERSION_ID,
      },
    ),
    false,
  );
});

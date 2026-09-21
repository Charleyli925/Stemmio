import { realpath } from "node:fs/promises";
import path from "node:path";

import { sha256 } from "../bridge/lifecycle-core.mjs";
import {
  assertAbsolutePath,
  assertObject,
  readVerifiedRegularFile,
} from "../bridge/agent/policies/execution-policy.mjs";
import { acpPolicyError } from "../bridge/agent/runtimes/acp-protocol.mjs";
import { projectControlPath } from "../shared/project-storage-contract.mjs";

export async function captureAcpReviewBoundary({
  repository,
  target,
  projectRoot,
}) {
  if (typeof repository?.workspace !== "function") {
    throw new TypeError("A ProjectFileRepository-compatible workspace reader is required.");
  }
  const verifiedTarget = assertObject(target, "Working Copy target");
  const verifiedProjectRoot = await realpath(
    assertAbsolutePath(projectRoot, "projectRoot"),
  );
  const targetProjectRoot = await realpath(
    assertAbsolutePath(verifiedTarget.projectRootPath, "target.projectRootPath"),
  );
  if (verifiedProjectRoot !== targetProjectRoot) {
    throw acpPolicyError(
      "ACP_REVIEW_EVIDENCE_INVALID",
      "The Working Copy evidence root does not match the target Project File.",
    );
  }
  const workspace = await repository.workspace({
    sourcePath: assertAbsolutePath(verifiedTarget.exactSourcePath, "target.exactSourcePath"),
  });
  if (!workspace) {
    throw acpPolicyError(
      "ACP_REVIEW_EVIDENCE_INVALID",
      "The Working Copy evidence workspace could not be loaded.",
    );
  }
  const controlRoot = projectControlPath(verifiedProjectRoot);
  const manifestFile = await readVerifiedRegularFile(
    path.join(controlRoot, "manifest.json"),
    verifiedProjectRoot,
    "Project manifest evidence",
  );
  const versionSnapshots = [];
  for (const version of workspace.manifest.versions) {
    const snapshot = await readVerifiedRegularFile(
      path.join(controlRoot, version.snapshotRelativePath),
      verifiedProjectRoot,
      "Version snapshot evidence",
    );
    versionSnapshots.push({
      versionId: version.versionId,
      contentSha256: sha256(snapshot.bytes),
    });
  }
  return {
    target: {
      projectId: workspace.target.projectId,
      documentId: workspace.target.documentId,
      workingCopyId: workspace.target.workingCopyId,
      versionId: workspace.target.versionId,
      targetKind: workspace.target.targetKind,
      exactSourcePath: workspace.target.exactSourcePath,
      sourceSha256: workspace.target.sourceSha256,
    },
    manifest: workspace.manifest,
    manifestFileSha256: sha256(manifestFile.bytes),
    workingCopy: workspace.workingCopy,
    workingCopyState: workspace.workingCopyState,
    workingCopies: workspace.workingCopies,
    draft: workspace.draft,
    contentSha256: sha256(Buffer.from(workspace.content, "utf8")),
    versionSnapshots,
  };
}

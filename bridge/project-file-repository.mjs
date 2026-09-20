import { commentsRemainingAfterAdoption } from "../shared/draft-aggregate.mjs";
import { CURRENT_DRAFT_SCHEMA_VERSION, currentDraftEvidence,
  listPreservedDrafts, readPreservedDraft, restorePreservedAttachments,
  verifyReplacedCurrentDraft as verifyReplacedCurrentDraftEvidence,
  prepareCurrentVersion, commitCurrentVersion, currentVersionTransactionPath, assertCurrentVersionTransaction, currentVersionNoopResult,
} from "./project-file-repository/current-draft.mjs";
import { readSubmissionReceipt, saveSubmissionReceipt, finishSubmissionReceipt, appendSubmissionExecutionFact, projectSubmissionReceipt } from "./project-file-repository/submission.mjs";
// Persistence façade. Internals live in ./project-file-repository/.
// Callers keep importing this module; the public surface is unchanged.
import { randomUUID } from "node:crypto";
import { retireSaveTransaction } from "./project-file-repository/save-retirement.mjs";
import {
  link,
  lstat,
  readFile,
  readdir,
  rename,
  rm,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { readSourceBinding, findBoundSource, refreshSourceBinding, assertUniqueSourceBinding, createSourceBindingIndex } from "./project-file-repository/source-binding.mjs";

import {
  WorkspacePerformanceTiming,
} from "./project-file-repository/workspace-performance-timing.mjs";

import {
  ensureDirectory,
  exists,
  jsonText,
  requireCompleteHtml,
  sha256,
  syncDirectory,
} from "./lifecycle-core.mjs";
import {
  activeDraftSnapshot,
  applyDraftCommand,
} from "./draft-service.mjs";
import {
  createProvenance,
  isDeviceIdentifier,
} from "../shared/provenance.mjs";
import {
  AiTaskProjectionError,
  materializeAiTaskProjection,
} from "./ai-task-projection.mjs";
import {
  normalizeAgentDelivery,
  normalizeNewAgentDelivery,
} from "../shared/agent-delivery.mjs";
import {
  isValidStemmioElementId,
  STEMMIO_ELEMENT_ID_SCHEMA_VERSION,
} from "../shared/stemmio-element-identity.mjs";
import {
  PROJECT_CONTROL_DIRECTORY_NAME,
  importTemporaryName,
  projectControlPath,
  projectRegistryPath,
} from "../shared/project-storage-contract.mjs";
import {
  assertTaskSpec,
} from "../shared/task-spec.mjs";

import {
  CURRENT_REGISTRY_WRITE_LOCK_GRACE_MS,
  CURRENT_REGISTRY_WRITE_LOCK_TIMEOUT_MS,
  acquireCurrentRegistryWriteLock,
  assertManifest,
  assertProjectIdentity,
  assertRegistry,
  assertRuntime,
  emptyRegistry,
  lastAiTaskAnchorFor,
  writeRuntimeState,
} from "./project-file-repository/registry.mjs";
import {
  DOCUMENT_ID,
  MAX_REQUEST_ATTACHMENT_BYTES,
  PROJECT_FILE_SCHEMA_VERSION,
  PROJECT_ID,
  RECONCILE_LOCATOR_REASONS,
  SAFE_OPERATION_ID,
  SAFE_REQUEST_ID,
  SHA256,
  SOURCE_ELEMENT_IDENTITY_MIGRATION_RECOVERY_ID,
  VERSION_ID,
  WORKING_COPY_ID,
} from "./project-file-repository/constants.mjs";
import {
  FROZEN_REQUEST_RULES,
  FROZEN_REQUEST_POLICY_VERSION,
  FROZEN_REQUEST_PROMPT_TEMPLATE_VERSION,
  REQUEST_FREEZE_RECOVERY_SCHEMA_VERSION,
  SUPPORTED_FROZEN_REQUEST_POLICY_VERSIONS,
  SUPPORTED_FROZEN_REQUEST_PROMPT_TEMPLATE_VERSIONS,
  assertWorkingCopyDraft,
  cancellationAuthorityPath,
  draftPathForState,
  requestInputFileRecord,
  requestFreezeMarkerPath,
  requestFreezeStagingRootPath,
  requestRootPath,
} from "./project-file-repository/request-draft.mjs";
import {
  isPageTargetReference,
} from "./candidate-assessment.mjs";
import {
  freezeRequestCommentAttachments,
} from "./project-file-repository/request-attachments.mjs";
import {
  ProjectFileRepositoryError,
  invalidRegisteredProjectError,
  registeredProjectCatalogAvailability,
} from "./project-file-repository/errors.mjs";
import {
  aiTaskCandidateFileName,
  assertPreferredFileStem,
  candidateIdForRequest,
  htmlExtension,
  preferredNamingForWorkingCopyPath,
  projectDirectoryName,
  randomId,
  safeProjectName,
  topLevelHtmlRelativePath,
  versionId,
  versionOrdinalFor,
  visibleFileName,
  workingCopyId,
} from "./project-file-repository/identity.mjs";
import {
  assertCandidateAssessment,
  assertCandidateIdentityReport,
  assertCandidateId,
  assessedCandidate,
  mapCandidateValidationError,
  versionSnapshotPath,
} from "./project-file-repository/version-candidate.mjs";
import {
  assertCandidateSourceIdentityOutput,
  prepareCandidateSourceIdentity,
} from "./project-file-repository/candidate-identity.mjs";
import {
  assertFileIdentity,
  assertId,
  assertSha256,
  atomicWriteProjectFile,
  atomicWriteProjectJson,
  cachedRealPath,
  copyFileIdentity,
  defaultProjectsRoot,
  directoryInformation,
  ensureProjectDirectory,
  ensureRelativePath,
  isObject,
  linkFileNoReplace,
  listProjectDirectory,
  normalizedPath,
  nowIso,
  pathInside,
  previewSnippet,
  projectPaths,
  readHtmlFile,
  readJsonFile,
  readJsonFileWithSha256,
  readRegularFileWithSha256,
  regularInformation,
  resolveRelative,
  sameFileIdentity,
  samePath,
  serialPathCache,
  validStateTimestamp,
  writeFileNoReplace,
} from "./project-file-repository/path-safety.mjs";
import {
  assertWorkingCopyState,
  compareAndSwapWorkingCopyFile,
  draftRelativePathFor,
  inspectSourceElementIdentity,
  materializeIdentityPreservingSave,
  materializeSourceElementIdentity,
  publicOpenTarget,
  saveRecoveryPaths,
  SOURCE_ELEMENT_IDENTITY_MIGRATION_TRANSACTION_SCHEMA_VERSION,
  sourceElementIdentityBindingSha256,
  sourceElementIdentityMigrationRecoveryPaths,
  workingCopySourcePath,
  workingCopyStatePath,
} from "./project-file-repository/working-copy.mjs";

export { PROJECT_FILE_SCHEMA_VERSION } from "./project-file-repository/constants.mjs";
export { ProjectFileRepositoryError } from "./project-file-repository/errors.mjs";

export function projectVersionDisplayFileName({ version, currentSourcePath, versionSourcePath }) {
  return path.basename(versionSourcePath || currentSourcePath || `版本-${version.ordinal}.html`);
}

const SAVE_RETIREMENT_ATTEMPT_LIMIT = 16;

async function retireOlderIdentityTransactions(paths, workingCopyId, keepPath) {
  const keepName = path.basename(keepPath);
  const prefix = `identity_${workingCopyId}_v${STEMMIO_ELEMENT_ID_SCHEMA_VERSION}_`;
  const entries = await readdir(paths.transactionsRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || entry.name === keepName) continue;
    if (!entry.name.startsWith(prefix) || !entry.name.endsWith(".json")) continue;
    const recoveryId = entry.name.slice(0, -".json".length);
    if (!SOURCE_ELEMENT_IDENTITY_MIGRATION_RECOVERY_ID.test(recoveryId)) continue;
    await unlink(path.join(paths.transactionsRoot, entry.name));
  }
  await syncDirectory(paths.transactionsRoot).catch(() => {});
}

export const DEFAULT_PROJECT_RULES_TEMPLATE = `# 项目长期规则

## 项目目标
<!-- 这个项目要达成什么？请写下长期目标和成功标准。 -->

## 目标受众
<!-- 谁会使用、阅读或受这个项目影响？ -->

## 内容与事实规则
<!-- 哪些事实必须准确？哪些内容需要引用、核验或避免猜测？ -->

## 视觉与表达
<!-- 记录视觉风格、语气、术语和表达偏好。 -->

## AI 修改边界
<!-- 哪些内容可以修改？哪些内容必须保留、先询问或不得触碰？ -->
`;

async function ensureProjectRulesFile(projectRootPath) {
  const filePath = path.join(projectRootPath, "PROJECT.md");
  const information = await regularInformation(filePath, "PROJECT.md", {
    projectRootPath,
  });
  if (information) return { filePath, information };
  const buffer = Buffer.from(DEFAULT_PROJECT_RULES_TEMPLATE, "utf8");
  await writeFileNoReplace(
    filePath,
    buffer,
    sha256(buffer),
    "PROJECT.md",
    { projectRootPath },
  );
  const createdInformation = await regularInformation(filePath, "PROJECT.md", {
    projectRootPath,
  });
  if (!createdInformation) {
    throw new ProjectFileRepositoryError(
      "PROJECT_FILE_NOT_FOUND",
      "PROJECT.md could not be created.",
    );
  }
  return { filePath, information: createdInformation };
}

function requestFreezeRecoveryError(message, details = {}) {
  return new ProjectFileRepositoryError(
    "REQUEST_FREEZE_RECOVERY_INVALID",
    message,
    details,
  );
}

// This is a persistence repository, not a runtime Store. Sessions keep the
// mutable UI facts; the repository only resolves and atomically records the
// on-disk facts specified by VERSION_AND_PROJECT_FILES_PRD.md.
export class ProjectFileRepository {
  #projectsRoot;

  #registryPath;

  #clock;

  #failpoint;

  #deviceId;

  #normalizeNewAgentDelivery;

  #registryWriteLockTimeoutMs;

  #registryWriteLockGraceMs;

  #registryWriteLockDepth = 0;

  #tail = Promise.resolve();

  constructor({
    projectsRoot = defaultProjectsRoot(),
    registryPath = projectRegistryPath(projectsRoot),
    clock = Date.now,
    deviceId = null,
    agentDeliveryNormalizer = normalizeNewAgentDelivery,
    failpoint = null,
    registryWriteLockTimeoutMs = CURRENT_REGISTRY_WRITE_LOCK_TIMEOUT_MS,
    registryWriteLockGraceMs = CURRENT_REGISTRY_WRITE_LOCK_GRACE_MS,
  } = {}) {
    this.#projectsRoot = normalizedPath(projectsRoot);
    this.#registryPath = normalizedPath(registryPath);
    this.#clock = typeof clock === "function" ? clock : Date.now;
    // A repository without a device identity records no provenance rather than
    // inventing one, so a test double or a misconfigured launch cannot attribute
    // a record to a device that does not exist.
    this.#deviceId = isDeviceIdentifier(deviceId) ? String(deviceId) : null;
    if (typeof agentDeliveryNormalizer !== "function") {
      throw new TypeError("ProjectFileRepository requires an Agent delivery normalizer.");
    }
    this.#normalizeNewAgentDelivery = agentDeliveryNormalizer;
    this.#failpoint = typeof failpoint === "function" ? failpoint : null;
    this.#registryWriteLockTimeoutMs = Number.isSafeInteger(registryWriteLockTimeoutMs)
      && registryWriteLockTimeoutMs >= 1
      ? registryWriteLockTimeoutMs
      : CURRENT_REGISTRY_WRITE_LOCK_TIMEOUT_MS;
    this.#registryWriteLockGraceMs = Number.isSafeInteger(registryWriteLockGraceMs)
      && registryWriteLockGraceMs >= 0
      ? registryWriteLockGraceMs
      : CURRENT_REGISTRY_WRITE_LOCK_GRACE_MS;
  }

  get projectsRoot() {
    return this.#projectsRoot;
  }

  // Every record this repository authors is attributed to the local human on
  // this device. The actor becomes an account identity once accounts exist; the
  // shape does not change then, only the identifier does.
  #localProvenance() {
    if (!this.#deviceId) return null;
    return createProvenance({ deviceId: this.#deviceId });
  }

  async initialize() {
    return this.#serial(async () => {
      await ensureDirectory(this.#projectsRoot);
      await this.#assertProjectsRoot();
      await this.#readRegistry();
      await this.#withRegistryWriteLock(async () => {
        if (!(await exists(this.#registryPath))) {
          await atomicWriteProjectJson(
            this.#projectsRoot,
            this.#registryPath,
            emptyRegistry(this.#clock),
            "project registry",
          );
        }
        await this.#recoverPublishedImports();
      });
      const registry = await this.#readRegistry();
      for (const projectId of Object.keys(registry.projects)) {
        try {
          await this.#withRegistryWriteLock(async () => {
            const initial = await this.#loadRegisteredProject({ projectId });
            await this.#recoverProject(initial.paths.projectRootPath);
            const loaded = await this.#ensureCurrentDraft(await this.#loadRegisteredProject({ projectId }));
            await this.#recoverSubmissionHistory(loaded, { restart: true });
            const bindingIndex = await createSourceBindingIndex(loaded.paths.projectRootPath, loaded.manifest.workingCopies);
            let locatorChanged = false;
            for (const workingCopy of loaded.manifest.workingCopies) {
              try {
                const resolved = await this.#resolveWorkingCopyPath(loaded, workingCopy, "Working Copy", { persistLocator: false, bindingIndex });
                locatorChanged = resolved.locatorChanged || locatorChanged;
              } catch { /* File status is exposed per project by the catalog. */ }
            }
            if (locatorChanged) await atomicWriteProjectJson(
              loaded.paths.projectRootPath, loaded.paths.manifestPath,
              loaded.manifest, "manifest.json",
            );
          });
        } catch { /* Recovery failures stay local to this registered project. */ }
      }
    });
  }

  async listRegisteredProjects() {
    return this.#serial(() => this.#listRegisteredProjects());
  }

  async restoreRegisteredWorkingCopy({ projectId } = {}) {
    return this.#writeSerial(async () => {
      const initial = await this.#loadRegisteredProject({ projectId });
      await this.#recoverProject(initial.paths.projectRootPath);
      const loaded = await this.#loadRegisteredProject({ projectId });
      const member = await this.#activeRegisteredWorkingCopy(loaded);
      const sourcePath = workingCopySourcePath(loaded.paths, member);
      if (await regularInformation(sourcePath, "Working Copy", { projectRootPath: loaded.paths.projectRootPath })) {
        throw new ProjectFileRepositoryError("WORKING_COPY_CONFLICT", "登记位置已有文件，未覆盖磁盘。");
      }
      const binding = await readSourceBinding(loaded.paths.projectRootPath, member.workingCopyId);
      await assertUniqueSourceBinding(loaded.paths.projectRootPath, loaded.manifest.workingCopies, member.workingCopyId, binding);
      if (!binding || await findBoundSource(loaded.paths.projectRootPath, binding)) {
        throw new ProjectFileRepositoryError("WORKING_COPY_UNAVAILABLE", "工作文件已移动或绑定不存在，请重新检查。");
      }
      const state = await readJsonFile(workingCopyStatePath(loaded.paths, member), "Working Copy state", { projectRootPath: loaded.paths.projectRootPath });
      assertWorkingCopyState(state, loaded, member);
      const source = await readHtmlFile(binding.bindingPath, "Working Copy binding", { projectRootPath: loaded.paths.projectRootPath });
      if (source.sha256 !== state.currentSha256 || !sameFileIdentity(
        copyFileIdentity(binding.information), copyFileIdentity(source.information),
      )) throw new ProjectFileRepositoryError("WORKING_COPY_CONFLICT", "绑定内容或对象已变化，未恢复工作文件。");
      const publication = await linkFileNoReplace(binding.bindingPath, sourcePath, state.currentSha256, "Working Copy", { projectRootPath: loaded.paths.projectRootPath });
      if (!publication.created || !sameFileIdentity(
        copyFileIdentity(binding.information), copyFileIdentity(publication.information),
      )) {
        throw new ProjectFileRepositoryError("WORKING_COPY_CONFLICT", "登记位置在恢复时被占用或替换，未采用该文件。");
      }
      await this.#resolveWorkingCopyPath(loaded, member, "Working Copy", { expectedInformation: binding.information });
      return { restored: true };
    });
  }

  async listRegisteredProjectVersionSummaries({ projectId } = {}) {
    return this.#serial(() => this.#listRegisteredProjectVersionSummaries({ projectId }));
  }

  async resolveRegisteredProjectOpenTarget({ projectId, workingCopyId = null } = {}) {
    return this.#writeSerial(() => this.#resolveRegisteredProjectOpenTarget({ projectId, workingCopyId }));
  }

  async importExternal({
    sourcePath,
    expectedSourceSha256 = null,
  } = {}) {
    return this.#serial(() => this.#importExternal({
      sourcePath,
      expectedSourceSha256,
    }));
  }

  async resolveOpenTarget({ sourcePath } = {}) {
    return this.#writeSerial(() => this.#resolveOpenTarget({ sourcePath }));
  }

  async classifyOpenPath({ sourcePath } = {}) {
    return this.#serial(() => this.#classifyOpenPath({ sourcePath }));
  }

  async reconcileWorkingCopyLocator({
    operationId,
    previousSourcePath,
    projectId,
    documentId,
    workingCopyId,
    versionId,
    expectedSourceSha256,
    reason,
  } = {}) {
    return this.#writeSerial(() => this.#reconcileWorkingCopyLocator({
      operationId,
      previousSourcePath,
      projectId,
      documentId,
      workingCopyId,
      versionId,
      expectedSourceSha256,
      reason,
    }));
  }

  async saveWorkingCopy({
    target,
    html,
    expectedSourceSha256,
    editRevision = 0,
    sourceHistoryOperations = [],
  } = {}) {
    return this.#writeSerial(() => this.#saveWorkingCopy({
      target,
      html,
      expectedSourceSha256,
      editRevision,
      sourceHistoryOperations,
    }));
  }

  async createCandidate({
    target,
    requestId,
    attemptId = "attempt_001",
    candidateId = null,
    html,
    expectedSourceSha256,
    requestedTargetElementIds = [],
    requestedTargetCount = null,
    requestedTargetIsPage = false,
  } = {}) {
    return this.#writeSerial(() => this.#createCandidate({
      target,
      requestId,
      attemptId,
      candidateId,
      html,
      expectedSourceSha256,
      requestedTargetElementIds,
      requestedTargetCount,
      requestedTargetIsPage,
      inputManifestSha256: null,
    }));
  }

  async rejectCandidate({ target, candidateId } = {}) {
    const requestedCandidateId = assertCandidateId(candidateId);
    return this.#writeSerial(() => this.#rejectCandidate({
      target,
      candidateId: requestedCandidateId,
    }));
  }

  async promoteCandidate({ target, candidateId, expectedSourceSha256, decisionOperationId } = {}) {
    const requestedCandidateId = assertCandidateId(candidateId);
    const expectedDecisionOperationId = `promote_${requestedCandidateId}`;
    if (decisionOperationId !== expectedDecisionOperationId) {
      throw new ProjectFileRepositoryError(
        "DECISION_IDENTITY_MISMATCH",
        "Adoption identity does not match this Candidate.",
      );
    }
    return this.#serial(() => this.#withRegistryWriteLock(() => this.#promoteCandidate({
      target,
      candidateId: requestedCandidateId,
      expectedSourceSha256,
      decisionOperationId,
    })));
  }

  async recoverProject({ projectRootPath } = {}) {
    return this.#writeSerial(() => this.#recoverProject(projectRootPath));
  }

  async workspace({ sourcePath } = {}) {
    const performanceTiming = new WorkspacePerformanceTiming();
    return this.#writeSerial(async () => {
      performanceTiming.markDequeued();
      const workspace = await this.#workspace({ sourcePath, performanceTiming });
      if (!workspace) return null;
      return { ...workspace, performanceTiming: performanceTiming.snapshot() };
    });
  }

  async forceUnlockWorkingCopy({
    projectId,
    documentId,
    sourcePath,
    expectedSourceSha256,
    operationId,
  } = {}) {
    return this.#writeSerial(() => this.#forceUnlockWorkingCopy({
      projectId,
      documentId,
      sourcePath,
      expectedSourceSha256,
      operationId,
    }));
  }

  async queryForceUnlockWorkingCopy({
    projectId,
    documentId,
    sourcePath,
    operationId,
  } = {}) {
    return this.#writeSerial(() => this.#queryForceUnlockWorkingCopy({
      projectId,
      documentId,
      sourcePath,
      operationId,
    }));
  }

  async createVersionFromHistory(input = {}) {
    return this.#serial(() => this.#withRegistryWriteLock(() => this.#createCurrentVersion({ ...input, sourceType: "history-copy" })));
  }

  async queryHistoryCreation(input = {}) {
    return this.#serial(() => this.#withRegistryWriteLock(() => this.#queryCurrentVersion(input, "history-copy")));
  }

  async createVersionFromCurrent(input = {}) {
    return this.#serial(() => this.#withRegistryWriteLock(() => this.#createCurrentVersion({ ...input, sourceType: "local-save" })));
  }

  async queryCurrentVersionCreation(input = {}) {
    return this.#serial(() => this.#withRegistryWriteLock(() => this.#queryCurrentVersion(input, "local-save")));
  }

  async restorePreservedDraft(input = {}) {
    return this.#serial(() => this.#withRegistryWriteLock(() => this.#createCurrentVersion({ ...input, sourceType: "recovery-copy" })));
  }

  async queryPreservedDraftRestore(input = {}) {
    return this.#serial(() => this.#withRegistryWriteLock(() => this.#queryCurrentVersion(input, "recovery-copy")));
  }

  async listPreservedDrafts({ projectId } = {}) {
    return this.#serial(async () => listPreservedDrafts(await this.#loadRegisteredProject({ projectId, readOnly: true })));
  }

  async readPreservedDraft({ projectId, recoveryId } = {}) {
    return this.#serial(async () => readPreservedDraft(await this.#loadRegisteredProject({ projectId, readOnly: true }), recoveryId));
  }

  async verifyReplacedCurrentDraft({ target, journal } = {}) {
    return this.#serial(async () => {
      if (!isObject(target) || target.targetKind !== "working-copy"
        || !target.projectId || !target.documentId) return { verified: false };
      const loaded = await this.#loadRegisteredProject({
        projectId: target.projectId, documentId: target.documentId,
        declaredProjectRootPath: normalizedPath(target.projectRootPath), readOnly: true,
      });
      const manifestBefore = await readJsonFileWithSha256(loaded.paths.manifestPath, "current manifest", { projectRootPath: loaded.paths.projectRootPath });
      if (JSON.stringify(manifestBefore.value) !== JSON.stringify(loaded.manifest)) return { verified: false };
      const member = loaded.manifest.workingCopies.find((entry) => entry.workingCopyId === target.workingCopyId);
      if (!member || member.workingCopyId !== loaded.runtime.activeWorkingCopyId || member.versionId !== target.versionId) return { verified: false };
      const resolved = await this.#resolveWorkingCopyPath(loaded, member, "current draft", { persistLocator: false, readOnly: true });
      if (resolved.sourceStatus !== "ready" || !samePath(resolved.exactSourcePath, target.exactSourcePath)
        || resolved.source.sha256 !== target.sourceSha256) return { verified: false };
      const result = await verifyReplacedCurrentDraftEvidence(loaded, {
        journal, currentSourcePath: resolved.exactSourcePath, currentSource: resolved.source,
      });
      if (!result.verified) return result;
      const manifestAfter = await readJsonFileWithSha256(loaded.paths.manifestPath, "current manifest", { projectRootPath: loaded.paths.projectRootPath });
      const sourceAfter = await readHtmlFile(resolved.exactSourcePath, "current draft", { projectRootPath: loaded.paths.projectRootPath });
      if (manifestBefore.sha256 !== manifestAfter.sha256 || resolved.source.sha256 !== sourceAfter.sha256
        || !sameFileIdentity(copyFileIdentity(resolved.source.information), copyFileIdentity(sourceAfter.information))) return { verified: false };
      return result;
    });
  }

  async #ensureCurrentDraft(loaded) {
    return this.#withRegistryWriteLock(async () => {
      const current = await this.#loadRegisteredProject({
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
      });
      if (current.manifest.currentDraftSchemaVersion !== CURRENT_DRAFT_SCHEMA_VERSION
        || current.manifest.workingCopies.length !== 1
        || Object.hasOwn(current.manifest, "retiredWorkingCopies")) {
        throw new ProjectFileRepositoryError(
          "CURRENT_DRAFT_UNSUPPORTED",
          "The project does not use the current single-draft format.",
        );
      }
      return current;
    });
  }

  async #createCurrentVersion({ target, operationId, expectedSourceSha256, sourceType, versionId: selectedVersionId, expectedSnapshotSha256, recoveryId = null }) {
    let loaded = await this.#historyCreationLoaded(target);
    const transactionPath = currentVersionTransactionPath(loaded, operationId);
    const expected = assertSha256(expectedSourceSha256, "expectedSourceSha256");
    const existing = await readJsonFile(transactionPath, "current Version transaction", { projectRootPath: loaded.paths.projectRootPath });
    if (existing) {
      if (existing.sourceType !== sourceType || existing.expectedSourceSha256 !== expected
        || (sourceType === "history-copy" && (existing.version?.basedOnVersionId !== selectedVersionId || existing.version?.contentSha256 !== expectedSnapshotSha256))
        || existing.recoveryId !== recoveryId) throw new ProjectFileRepositoryError(sourceType === "history-copy" ? "HISTORY_CREATION_OPERATION_MISMATCH" : "CURRENT_VERSION_OPERATION_MISMATCH", "This operation identity belongs to another Version request.");
      if (existing.state === "unchanged") return currentVersionNoopResult(loaded, existing, operationId);
      return commitCurrentVersion(loaded, existing, { hit: (name) => this.#hit(name) });
    }
    if (loaded.runtime.activeRequest || loaded.runtime.activeCandidateId) throw new ProjectFileRepositoryError("HISTORY_CREATION_RUN_LOCKED", "Finish the active AI task or Candidate decision before creating a Version.");
    await this.#recoverProject(loaded.paths.projectRootPath);
    loaded = await this.#ensureCurrentDraft(loaded);
    const member = await this.#activeRegisteredWorkingCopy(loaded);
    if (target.workingCopyId !== member.workingCopyId) throw new ProjectFileRepositoryError("WORKING_COPY_NOT_CURRENT", "Only the current draft is editable.");
    const evidence = await currentDraftEvidence(loaded, member);
    if (evidence.source.sha256 !== expected) throw new ProjectFileRepositoryError(sourceType === "history-copy" ? "HISTORY_CREATION_SOURCE_CHANGED" : "WORKING_COPY_CONFLICT", "The current draft changed before creating a Version.");
    let sourceHtml = evidence.source.html;
    let basedOnVersionId = member.basedOnVersionId;
    let draft;
    if (sourceType === "local-save" && (evidence.state.snapshotBaselineSha256 || evidence.state.baseSha256) === evidence.source.sha256) {
      const latest = loaded.manifest.versions.find((v) => v.versionId === loaded.manifest.latestOfficialVersionId);
      const result = { status: "unchanged", operationId, projectId: loaded.project.projectId, documentId: loaded.project.documentId,
        workingCopyId: member.workingCopyId, sourcePath: evidence.source.filePath || workingCopySourcePath(loaded.paths, member),
        sourceSha256: evidence.source.sha256, versionId: latest.versionId, versionOrdinal: latest.ordinal };
      await ensureProjectDirectory(loaded.paths.projectRootPath, path.dirname(transactionPath), "current Version receipt");
      await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, { schemaVersion: CURRENT_DRAFT_SCHEMA_VERSION, kind: "current-version-noop", operationId, projectId: loaded.project.projectId, documentId: loaded.project.documentId, state: "unchanged", sourceType, recoveryId, expectedSourceSha256: expected, result }, "unchanged Version receipt");
      return result;
    }
    if (sourceType === "history-copy") {
      const version = loaded.manifest.versions.find((v) => v.versionId === selectedVersionId);
      if (!version || version.contentSha256 !== assertSha256(expectedSnapshotSha256, "expectedSnapshotSha256")) throw new ProjectFileRepositoryError("VERSION_SNAPSHOT_HASH_MISMATCH", "The selected snapshot no longer matches the request.");
      const snapshot = await readHtmlFile(versionSnapshotPath(loaded.paths, version), "historical snapshot", { projectRootPath: loaded.paths.projectRootPath });
      if (snapshot.sha256 !== version.contentSha256) throw new ProjectFileRepositoryError("VERSION_SNAPSHOT_HASH_MISMATCH", "The historical snapshot changed.");
      sourceHtml = snapshot.html; basedOnVersionId = version.versionId; draft = null;
    } else if (sourceType === "recovery-copy") {
      const preserved = await readPreservedDraft(loaded, recoveryId);
      await restorePreservedAttachments(loaded, preserved);
      sourceHtml = preserved.html; basedOnVersionId = preserved.basedOnVersionId; draft = preserved.draft;
    }
    const transaction = await prepareCurrentVersion(loaded, { operationId, expectedSourceSha256: expected, sourceType,
      sourceHtml, basedOnVersionId, draft, recoveryId, clock: () => nowIso(this.#clock) });
    await this.#hit("current-version-prepared");
    const result = await commitCurrentVersion(loaded, transaction, { hit: (name) => this.#hit(name) });
    if (sourceType === "history-copy" && result.status === "created") {
      loaded.runtime.historyCreation = { operationId, versionId: result.versionId };
      await this.#writeRuntime(loaded);
    }
    return result;
  }

  async #queryCurrentVersion({ target, operationId, markOpened = false }, sourceType) {
    const loaded = await this.#historyCreationLoaded(target);
    const transactionPath = currentVersionTransactionPath(loaded, operationId);
    const transaction = await readJsonFile(transactionPath, "current Version transaction", { projectRootPath: loaded.paths.projectRootPath });
    if (!transaction) return sourceType === "history-copy" ? this.#queryHistoryCreation({ target, operationId, markOpened }) : { status: "not-created", operationId, projectId: loaded.project.projectId, documentId: loaded.project.documentId };
    if (transaction.sourceType !== sourceType) throw new ProjectFileRepositoryError("CURRENT_VERSION_OPERATION_MISMATCH", "The Version request has a different source.");
    if (transaction.state === "unchanged") return currentVersionNoopResult(loaded, transaction, operationId);
    const result = await commitCurrentVersion(loaded, transaction, { hit: (name) => this.#hit(name) });
    if (markOpened && !transaction.openedAt) {
      transaction.openedAt = nowIso(this.#clock);
      await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, transaction, "current Version transaction");
      result.openedAt = transaction.openedAt;
      if (result.recoveryState === "pending") result.recoveryState = "opened";
    }
    return result;
  }

  async #promoteCurrentCandidate(loaded, { target, candidateId, expectedSourceSha256, decisionOperationId }) {
    candidateId ||= loaded.runtime.activeCandidateId;
    if (!candidateId) throw new ProjectFileRepositoryError("CANDIDATE_NOT_FOUND", "No Candidate is awaiting review.");
    assertCandidateId(candidateId);
    const decisionId = `promote_${candidateId}`;
    const operationId = decisionId.length <= 160 ? decisionId : `promote_${sha256(Buffer.from(candidateId)).slice(7, 39)}`;
    if (decisionOperationId !== undefined && decisionOperationId !== decisionId) throw new ProjectFileRepositoryError("DECISION_IDENTITY_MISMATCH", "Adoption identity does not match the Candidate.");
    const transactionPath = currentVersionTransactionPath(loaded, operationId);
    let transaction = await readJsonFile(transactionPath, "current adoption", { projectRootPath: loaded.paths.projectRootPath });
    if (!transaction) {
      const resolved = await this.#resolveMutationTarget(target);
      const candidateState = await this.#readCandidateForLoaded(resolved, candidateId);
      const candidate = candidateState.candidate;
      if (expectedSourceSha256 !== undefined && expectedSourceSha256 !== candidate.expectedSourceSha256) throw new ProjectFileRepositoryError("SOURCE_HASH_CONFLICT", "Adoption does not match the reviewed source.");
      await this.#assertCandidateSourceCurrent(resolved, candidate);
      const evidence = await currentDraftEvidence(resolved, resolved.workingCopy, resolved.source);
      const request = await readJsonFile(path.join(requestRootPath(loaded.paths, candidate.requestId), "request.json"), "request.json", { projectRootPath: loaded.paths.projectRootPath });
      const submission = request?.request?.submissionOperationId ? await readSubmissionReceipt(resolved, request.request.submissionOperationId) : null;
      const comments = commentsRemainingAfterAdoption(evidence.draft?.comments || [], submission?.snapshot.comments || request?.request?.comments || []);
      const draft = { ...(evidence.draft || {}), schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        draftRevision: Number(evidence.draft?.draftRevision || 0) + 1, comments,
        changeEvents: [], deletedCommentIds: [], appliedOperationIds: [], updatedAt: nowIso(this.#clock) };
      transaction = await prepareCurrentVersion(resolved, { operationId, expectedSourceSha256: candidate.expectedSourceSha256,
        sourceType: "internal-ai", sourceHtml: candidateState.output.html, basedOnVersionId: candidate.basedOnVersionId,
        draft, requestId: candidate.requestId, candidateId, clock: () => nowIso(this.#clock) });
      await this.#hit("current-version-prepared");
    } else if (expectedSourceSha256 !== undefined && transaction.expectedSourceSha256 !== expectedSourceSha256) {
      throw new ProjectFileRepositoryError("SOURCE_HASH_CONFLICT", "Adoption does not match the original request.");
    }
    return this.#resumeCurrentPromotion(loaded, transaction);
  }

  async #resumeCurrentPromotion(loaded, transaction) {
    const state = await this.#readCandidateForLoaded(loaded, transaction.version.sourceCandidateId);
    const candidate = state.candidate;
    if (transaction.sourceType !== "internal-ai" || candidate.candidateId !== transaction.version.sourceCandidateId || candidate.requestId !== transaction.version.sourceRequestId
      || candidate.outputSha256 !== transaction.version.contentSha256 || candidate.expectedSourceSha256 !== transaction.expectedSourceSha256
      || candidate.proposedVersionId !== transaction.version.versionId || candidate.previousVersionId !== transaction.version.previousVersionId
      || candidate.basedOnVersionId !== transaction.version.basedOnVersionId
      || candidate.sourceWorkingCopyId !== transaction.beforeMember.workingCopyId) {
      throw new ProjectFileRepositoryError("CURRENT_VERSION_TRANSACTION_MISMATCH", "The adoption no longer matches its sealed Candidate.");
    }
    const committed = await commitCurrentVersion(loaded, transaction, { hit: (name) => this.#hit(name) });
    if (committed.status !== "created") throw new ProjectFileRepositoryError("WORKING_COPY_CONFLICT", "The adoption was interrupted by a changed current draft.");
    const ownsActiveDecision = loaded.runtime.activeCandidateId === candidate.candidateId
      && loaded.runtime.activeRequest?.requestId === candidate.requestId
      && loaded.runtime.activeRequest?.candidateId === candidate.candidateId
      && loaded.runtime.activeRequest?.attemptId === candidate.attemptId;
    if (!ownsActiveDecision && candidate.status !== "promoted") {
      throw new ProjectFileRepositoryError("CURRENT_VERSION_TRANSACTION_MISMATCH", "The unfinished adoption no longer owns the active decision.");
    }
    const requestPath = path.join(requestRootPath(loaded.paths, candidate.requestId), "request.json");
    const request = await readJsonFile(requestPath, "request.json", { projectRootPath: loaded.paths.projectRootPath });
    if (ownsActiveDecision) {
      candidate.status = "promoted";
      candidate.promotedAt ||= nowIso(this.#clock);
      candidate.promotedVersionId = transaction.version.versionId;
      await atomicWriteProjectJson(loaded.paths.projectRootPath, state.candidatePath, candidate, "candidate.json");
      await this.#hit("promotion-candidate-promoted");
      if (request?.candidateId === candidate.candidateId) {
        request.status = "promoted"; request.promotedVersionId = transaction.version.versionId; request.promotedAt = candidate.promotedAt;
        await this.#writeRequestWithHistory(loaded, requestPath, request);
      }
      // A completed decision may be replayed after a newer Request starts.
      // Only the exact owning Request/Candidate can release this write fence.
      loaded.runtime.activeRequest = null; loaded.runtime.activeCandidateId = null;
      await this.#writeRuntime(loaded);
    }
    const current = loaded.manifest.workingCopies[0];
    if (request?.request?.submissionOperationId) {
      await appendSubmissionExecutionFact({ ...loaded, workingCopy: current }, request.request.submissionOperationId, {
        eventId: `event_${transaction.operationId}_completed`, kind: "promoted",
        timestamp: candidate.promotedAt, candidateId: candidate.candidateId,
      }).catch(() => {}); // The committed transaction is durable replay authority.
    }
    const sourcePath = workingCopySourcePath(loaded.paths, current);
    const source = await readHtmlFile(sourcePath, "current draft", { projectRootPath: loaded.paths.projectRootPath });
    return { promoted: true, version: transaction.version,
      target: publicOpenTarget({ project: loaded.project, projectRootPath: loaded.paths.projectRootPath,
        targetKind: "working-copy", workingCopy: current, version: loaded.manifest.versions.find((version) => version.versionId === current.versionId),
        exactSourcePath: sourcePath, sourceSha256: source.sha256 }) };
  }

  async recordSubmission({ target, operationId, input }) {
    return this.#writeSerial(async () => {
      const loaded = await this.#resolveMutationTarget(target);
      const { filePath: projectRulesPath } = await ensureProjectRulesFile(loaded.paths.projectRootPath);
      return saveSubmissionReceipt(loaded, { operationId, input, projectRulesPath }, nowIso(this.#clock));
    });
  }

  async submissionReceipt({ target, operationId }) {
    return this.#writeSerial(async () => readSubmissionReceipt(await this.#resolveMutationTarget(target), operationId));
  }

  async finishSubmission({ target, operationId, status, errorCode }) {
    return this.#writeSerial(async () => finishSubmissionReceipt(await this.#resolveMutationTarget(target),
      { operationId, status, errorCode }, nowIso(this.#clock)));
  }

  async recordExecutionFact({ target, requestId, attemptId, event }) {
    return this.#writeSerial(async () => {
      const loaded = await this.#resolveMutationTarget(target);
      const record = await readJsonFile(path.join(requestRootPath(loaded.paths, requestId), "request.json"), "request.json", { projectRootPath: loaded.paths.projectRootPath });
      this.#assertRequestRecord(record, loaded, { requestId, attemptId });
      const operationId = record.request?.submissionOperationId;
      if (!operationId) return null; // Never invent history for older Requests.
      return appendSubmissionExecutionFact(loaded, operationId, event);
    });
  }

  async #writeRequestWithHistory(loaded, requestPath, record) {
    const operationId = record.request?.submissionOperationId;
    if (operationId && ["candidate-ready", "no-change", "cancelled", "error", "rejected"].includes(record.status)) {
      const eventId = `event_${record.requestId}_${record.attemptId}_${record.status.replaceAll("-", "_")}`;
      record.conversationEvents = [...(record.conversationEvents || []).filter((event) => event.eventId !== eventId), {
        eventId, kind: record.status, timestamp: record.rejectedAt || record.cancelledAt || record.completedAt || record.createdAt,
        ...(record.status === "candidate-ready" ? { candidateId: record.candidateId } : {}),
      }];
    }
    await atomicWriteProjectJson(loaded.paths.projectRootPath, requestPath, record, "request.json");
    if (operationId) {
      await this.#hit("request-history-pending", { requestId: record.requestId, status: record.status });
      // The Request and stable event ids are already durable. Projection failure
      // cannot turn a completed result into another generation attempt.
      for (const event of record.conversationEvents || []) {
        try { await appendSubmissionExecutionFact(loaded, operationId, event); }
        catch { break; } // Replayed from the same authoritative outbox on recovery.
      }
    }
  }

  async #recoverSubmissionHistory(loaded, { restart = false } = {}) {
    const submissionsRoot = projectControlPath(loaded.paths.projectRootPath, "submissions");
    if (!await directoryInformation(submissionsRoot, "submissions", { projectRootPath: loaded.paths.projectRootPath })) return;
    const entries = await listProjectDirectory(loaded.paths.projectRootPath, submissionsRoot, "submissions");
    for (const entry of entries) {
      if (!entry.isFile() || !/^submission_[a-f0-9]{32}\.json$/u.test(entry.name)) continue;
      const operationId = entry.name.slice(0, -5);
      const raw = await readJsonFile(projectControlPath(loaded.paths.projectRootPath, "submissions", entry.name), "submission", { projectRootPath: loaded.paths.projectRootPath });
      const workingCopy = loaded.manifest.workingCopies.find((value) => value.workingCopyId === raw?.workingCopyId);
      if (!workingCopy) continue;
      const bound = { ...loaded, workingCopy };
      const receipt = await readSubmissionReceipt(bound, operationId);
      const record = await readJsonFile(path.join(requestRootPath(loaded.paths, receipt.requestId), "request.json"), "request.json", { projectRootPath: loaded.paths.projectRootPath });
      if (record) {
        this.#assertRequestRecord(record, bound, { requestId: receipt.requestId, attemptId: receipt.attemptId });
        if (record.request?.submissionOperationId !== operationId) throw new ProjectFileRepositoryError("SUBMISSION_IDENTITY_MISMATCH", "Request does not match submission.");
        await finishSubmissionReceipt(bound, { operationId, status: "request-created" }, record.createdAt);
        for (const event of record.conversationEvents || []) await appendSubmissionExecutionFact(bound, operationId, event);
        if (record.status === "promoted") {
          const decisionId = `promote_${record.candidateId}`;
          const currentOperation = decisionId.length <= 160 ? decisionId : `promote_${sha256(Buffer.from(record.candidateId)).slice(7, 39)}`;
          const currentTransaction = await readJsonFile(currentVersionTransactionPath(loaded, currentOperation), "current adoption transaction", { projectRootPath: loaded.paths.projectRootPath });
          if (currentTransaction?.state === "completed") {
            assertCurrentVersionTransaction(loaded, currentTransaction, currentOperation);
            if (currentTransaction.version.sourceRequestId !== record.requestId || currentTransaction.version.sourceCandidateId !== record.candidateId) throw new ProjectFileRepositoryError("SUBMISSION_IDENTITY_MISMATCH", "The adoption belongs to a different Request.");
            await appendSubmissionExecutionFact(bound, operationId, { eventId: `event_${currentOperation}_completed`, kind: "promoted", timestamp: record.promotedAt, candidateId: record.candidateId });
          }
        }
        if (restart && record.status === "processing") {
          await appendSubmissionExecutionFact(bound, operationId, {
            eventId: `event_${receipt.requestId}_${receipt.attemptId}_interrupted`, kind: "interrupted",
            timestamp: receipt.events?.find((event) => event.kind === "interrupted")?.timestamp || nowIso(this.#clock),
          });
        }
      } else if (restart && receipt.status === "accepted") {
        await finishSubmissionReceipt(bound, { operationId, status: "not-started", errorCode: "SUBMISSION_INTERRUPTED_BEFORE_REQUEST" }, nowIso(this.#clock));
      } else await projectSubmissionReceipt(bound, receipt);
    }
  }

  async prepareRequest({
    target,
    requestId,
    attemptId = "attempt_001",
    expectedSourceSha256,
    request = {},
    prompt = "",
  } = {}) {
    return this.#writeSerial(() => this.#prepareRequest({
      target,
      requestId,
      attemptId,
      expectedSourceSha256,
      request,
      prompt,
    }));
  }

  async completeRequest({
    target,
    requestId,
    attemptId = "attempt_001",
    html,
  } = {}) {
    return this.#writeSerial(() => this.#completeRequest({
      target,
      requestId,
      attemptId,
      html,
    }));
  }

  async requestStatus({ target, requestId, attemptId = "attempt_001" } = {}) {
    return this.#writeSerial(() => this.#requestStatus({ target, requestId, attemptId }));
  }

  async cancelRequest({ target, requestId, attemptId = "attempt_001", discardCandidate = false } = {}) {
    return this.#writeSerial(() => this.#cancelRequest({ target, requestId, attemptId, discardCandidate }));
  }

  async saveDraft({
    target,
    operationId,
    expectedDraftRevision,
    basedOnVersionId,
    comments,
    changeEvents,
    deletedCommentIds,
  } = {}) {
    return this.#writeSerial(() => this.#saveDraft({
      target,
      operationId,
      expectedDraftRevision,
      basedOnVersionId,
      comments,
      changeEvents,
      deletedCommentIds,
    }));
  }

  async readVersionFile({ target, versionId: requestedVersionId } = {}) {
    return this.#writeSerial(() => this.#readVersionFile({ target, requestedVersionId }));
  }

  async resolveVersionWorkingCopy({ target, versionId: requestedVersionId } = {}) {
    return this.#writeSerial(() => this.#resolveVersionWorkingCopy({
      target,
      requestedVersionId,
    }));
  }

  async materializeAiTaskProjection({
    target,
    requestId,
    attemptId = "attempt_001",
    candidateId = null,
  } = {}) {
    return this.#writeSerial(() => this.#materializeAiTaskProjection({
      target,
      requestId,
      attemptId,
      candidateId,
    }));
  }

  async materializeCurrentAiTaskProjection({ target } = {}) {
    return this.#writeSerial(() => this.#materializeCurrentAiTaskProjection({ target }));
  }

  async readCandidate({ target, candidateId: requestedCandidateId } = {}) {
    return this.#serial(async () => {
      const loaded = await this.#resolveMutationTarget(target);
      const result = await this.#readCandidateForLoaded(loaded, requestedCandidateId);
      return {
        candidate: structuredClone(result.candidate),
        content: result.output.html,
        sha256: result.output.sha256,
      };
    });
  }

  async readProjectNotes({ target } = {}) {
    return this.#serial(async () => {
      const loaded = await this.#resolveMutationTarget(target);
      const { filePath, information } = await ensureProjectRulesFile(
        loaded.paths.projectRootPath,
      );
      const buffer = await readFile(filePath);
      return {
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        path: filePath,
        content: buffer.toString("utf8"),
        sha256: sha256(buffer),
        updatedAt: information.mtime.toISOString(),
      };
    });
  }

  async updateProjectNotes({ target, content } = {}) {
    return this.#serial(async () => {
      const loaded = await this.#resolveMutationTarget(target);
      if (typeof content !== "string") {
        throw new ProjectFileRepositoryError(
          "INVALID_PROJECT_FILE",
          "PROJECT.md must be Markdown text.",
        );
      }
      const filePath = path.join(loaded.paths.projectRootPath, "PROJECT.md");
      const information = await regularInformation(filePath, "PROJECT.md", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      if (!information) {
        throw new ProjectFileRepositoryError(
          "PROJECT_FILE_NOT_FOUND",
          "PROJECT.md was not found.",
        );
      }
      const previous = await readFile(filePath);
      const next = Buffer.from(content, "utf8");
      const updated = !previous.equals(next);
      if (updated) {
        await atomicWriteProjectFile(
          loaded.paths.projectRootPath,
          filePath,
          next,
          "PROJECT.md",
        );
      }
      return {
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        path: filePath,
        content,
        sha256: sha256(next),
        updated,
      };
    });
  }

  async #writeSerial(operation) {
    return this.#serial(() => this.#withRegistryWriteLock(operation));
  }

  async #serial(operation) {
    const run = () => serialPathCache.run({
      realPaths: new Map(),
      verifiedRoots: new Map(),
    }, operation);
    const current = this.#tail.then(run, run);
    this.#tail = current.catch(() => {});
    return current;
  }

  async #withRegistryWriteLock(operation) {
    if (this.#registryWriteLockDepth > 0) {
      this.#registryWriteLockDepth += 1;
      try {
        return await operation();
      } finally {
        this.#registryWriteLockDepth -= 1;
      }
    }
    const release = await acquireCurrentRegistryWriteLock({
      projectsRoot: this.#projectsRoot,
      timeoutMs: this.#registryWriteLockTimeoutMs,
      graceMs: this.#registryWriteLockGraceMs,
      now: this.#clock,
      onBeforeRetire: (details) => this.#hit(
        "registry-write-lock-before-retire",
        details,
      ),
    });
    this.#registryWriteLockDepth = 1;
    try {
      return await operation();
    } finally {
      this.#registryWriteLockDepth = 0;
      await release();
    }
  }

  async #hit(name, details = {}) {
    if (!this.#failpoint) return;
    const injected = await this.#failpoint(name, details);
    if (injected) {
      throw new ProjectFileRepositoryError(
        "INJECTED_FAILPOINT",
        `Failpoint ${name} was injected.`,
        { name, ...details },
      );
    }
  }

  async #readRegistry() {
    const record = await readJsonFileWithSha256(this.#registryPath, "project registry", {
      projectRootPath: this.#projectsRoot,
    });
    if (!record) return emptyRegistry(this.#clock);
    // A current Registry is strictly read-only at this boundary. In particular,
    // validation must not refresh its timestamp or normalize its bytes merely
    // because it was opened.
    return assertRegistry(record.value);
  }

  async #writeRuntime(loaded) {
    loaded.runtime = await writeRuntimeState(
      loaded.paths.projectRootPath,
      loaded.paths.runtimePath,
      loaded.runtime,
    );
  }

  async #workspace({
    sourcePath,
    adoptExternalConflict = false,
    expectedExternalSha256 = null,
    expectedProjectId = null,
    expectedDocumentId = null,
    performanceTiming = new WorkspacePerformanceTiming(),
  }) {
    const expectedIdentity = adoptExternalConflict
      ? Object.freeze({
        projectId: assertId(expectedProjectId, PROJECT_ID, "projectId"),
        documentId: assertId(expectedDocumentId, DOCUMENT_ID, "documentId"),
        sourcePath: normalizedPath(sourcePath),
      })
      : null;
    const assertExpectedIdentity = (target) => {
      if (!expectedIdentity || !target) return;
      if (
        target.projectId !== expectedIdentity.projectId
        || target.documentId !== expectedIdentity.documentId
        || !samePath(target.exactSourcePath, expectedIdentity.sourcePath)
      ) {
        throw new ProjectFileRepositoryError(
          "SOURCE_IDENTITY_MISMATCH",
          "The force-unlock target no longer matches the confirmed document identity.",
          {
            expectedProjectId: expectedIdentity.projectId,
            expectedDocumentId: expectedIdentity.documentId,
            expectedSourcePath: expectedIdentity.sourcePath,
            actualProjectId: target.projectId,
            actualDocumentId: target.documentId,
            actualSourcePath: target.exactSourcePath,
          },
        );
      }
    };
    if (expectedIdentity) {
      const preflightTarget = await this.#resolveOpenTarget({
        sourcePath: expectedIdentity.sourcePath,
        readOnly: true,
      });
      if (!preflightTarget) return null;
      assertExpectedIdentity(preflightTarget);
    }
    // A save can park the visible source in its private recovery directory
    // between two no-replace publishes. Recover the registered project before
    // resolving the requested HTML so a crash in that narrow interval does
    // not make the transaction unreachable merely because its visible name is
    // temporarily absent.
    const registered = await this.#registeredProjectForSource(sourcePath);
    performanceTiming.checkpoint("registryResolveMs");
    if (registered) {
      await this.#recoverProject(registered.paths.projectRootPath);
      await this.#ensureCurrentDraft(registered);
    }
    performanceTiming.checkpoint("recoveryMs");
    let target = await this.#resolveOpenTarget({ sourcePath });
    performanceTiming.checkpoint("registryResolveMs");
    if (!target) return null;
    assertExpectedIdentity(target);
    // Recover any current-version transaction before exposing workspace facts,
    // so a crash cannot leave a half-Version between review and publication.
    // Resolution may refresh locators/bindings, but creates no recovery task.
    // Reuse only the completed recovery for this exact business identity/root;
    // target resolution and the following load still validate disk afresh.
    const alreadyRecovered = registered
      && registered.project.projectId === target.projectId
      && registered.project.documentId === target.documentId
      && samePath(registered.paths.projectRootPath, target.projectRootPath);
    const recovered = alreadyRecovered ? [] : await this.#recoverProject(target.projectRootPath);
    if (!alreadyRecovered) performanceTiming.checkpoint("recoveryMs");
    if (recovered.length > 0) {
      target = await this.#resolveOpenTarget({ sourcePath });
      performanceTiming.checkpoint("registryResolveMs");
      if (!target) return null;
      assertExpectedIdentity(target);
    }
    const loaded = await this.#loadRegisteredProject({
      projectId: target.projectId,
      documentId: target.documentId,
      declaredProjectRootPath: target.projectRootPath,
    });
    performanceTiming.checkpoint("projectReloadMs");
    const workingCopy = target.workingCopyId
      ? loaded.manifest.workingCopies.find(
        (entry) => entry.workingCopyId === target.workingCopyId,
      )
      : null;
    let state = workingCopy
      ? await readJsonFile(workingCopyStatePath(loaded.paths, workingCopy), "Working Copy state", {
        projectRootPath: loaded.paths.projectRootPath,
      })
      : null;
    if (workingCopy) {
      const missingLegacyIdentityBinding = (
        state?.sourceElementIdentitySchemaVersion
          === STEMMIO_ELEMENT_ID_SCHEMA_VERSION
        && state.sourceElementIdentityBindingSha256 === undefined
      );
      if (missingLegacyIdentityBinding && !adoptExternalConflict) {
        throw new ProjectFileRepositoryError(
          "WORKING_COPY_CONFLICT",
          "The Working Copy identity binding must be explicitly adopted before use.",
          { workingCopyId: workingCopy.workingCopyId },
        );
      }
      assertWorkingCopyState(state, loaded, workingCopy, {
        allowMissingIdentityBinding: adoptExternalConflict,
      });
    }
    let draft = null;
    if (workingCopy && state) {
      const draftRecord = await readJsonFileWithSha256(
        draftPathForState(loaded.paths, workingCopy, state),
        "Working Copy draft",
        { projectRootPath: loaded.paths.projectRootPath },
      );
      if (draftRecord) {
        draft = assertWorkingCopyDraft(
          draftRecord.value,
          draftRecord.sha256,
          state,
          loaded,
          workingCopy,
        );
      } else if (state.draftSha256 !== null) {
        throw new ProjectFileRepositoryError(
          "WORKING_COPY_DRAFT_INVALID",
          "The Working Copy Draft is missing while its durable state references it.",
          { workingCopyId: workingCopy.workingCopyId },
        );
      }
    }
    const activeRequest = loaded.runtime.activeRequest
      ? await readJsonFile(
        path.join(
          requestRootPath(loaded.paths, loaded.runtime.activeRequest.requestId),
          "request.json",
        ),
        "active request.json",
        { projectRootPath: loaded.paths.projectRootPath },
      )
      : null;
    if (activeRequest) {
      this.#assertRequestRecord(activeRequest, { ...loaded, workingCopy }, {
        requestId: loaded.runtime.activeRequest.requestId,
        attemptId: loaded.runtime.activeRequest.attemptId,
      });
    }
    const activeCandidate = (
      activeRequest?.status === "candidate-ready"
      && activeRequest.candidateId
    )
      ? await this.#readCandidateForLoaded(
        { ...loaded, workingCopy },
        activeRequest.candidateId,
      )
      : null;
    // A terminal no-change/error Request is not active runtime authority, but
    // its sealed runtime anchor is enough to reconstruct the immutable
    // display outcome after a relaunch. Do not scan Request directories: the
    // anchor and its verified Request record remain the only admission path.
    const terminalAiTask = !activeRequest && loaded.runtime.lastAiTask
      ? await this.#terminalAiTaskForLoaded(loaded)
      : null;
    performanceTiming.checkpoint("stateFilesReadMs");
    let source = await readHtmlFile(target.exactSourcePath, "managed HTML", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (
      adoptExternalConflict
      && source.sha256 !== assertSha256(
        expectedExternalSha256,
        "expectedSourceSha256",
      )
    ) {
      throw new ProjectFileRepositoryError(
        "SOURCE_HASH_CONFLICT",
        "The Working Copy changed after the external version was confirmed.",
        {
          expectedSourceSha256: expectedExternalSha256,
          actualSourceSha256: source.sha256,
        },
      );
    }
    performanceTiming.checkpoint("sourceReadMs");
    let workingCopyRecovered = false;
    if (workingCopy && state && target.targetKind === "working-copy") {
      const reconciliation = adoptExternalConflict
        ? await this.#adoptExternalWorkingCopyState({
          loaded,
          workingCopy,
          state,
          source,
        })
        : await this.#reconcileExternalWorkingCopyState({
          loaded,
          workingCopy,
          state,
          source,
        });
      state = reconciliation.state;
      workingCopyRecovered = reconciliation.recovered;
      if (workingCopyRecovered) {
        draft = await readJsonFile(
          draftPathForState(loaded.paths, workingCopy, state),
          "Working Copy draft",
          { projectRootPath: loaded.paths.projectRootPath },
        );
      }
    }
    performanceTiming.checkpoint("workingCopyReconcileMs");
    let workingCopyIdentityMigrated = false;
    let workingCopyIdentityAdopted = false;
    if (workingCopy && state && target.targetKind === "working-copy") {
      const identityMigration = await this.#ensureSourceElementIdentity({
        loaded,
        workingCopy,
        state,
        source,
      });
      source = identityMigration.source;
      state = identityMigration.state;
      workingCopyIdentityMigrated = identityMigration.migrated;
      workingCopyIdentityAdopted = identityMigration.adopted;
      target = Object.freeze({
        ...target,
        sourceSha256: source.sha256,
      });
      if (adoptExternalConflict && loaded.runtime.activeRequest) {
        loaded.runtime.activeRequest = null;
        loaded.runtime.activeCandidateId = null;
        await this.#writeRuntime(loaded);
      }
    }
    performanceTiming.checkpoint("workingCopyIdentityMs");
    // The active Working Copy can be reconciled from a clean external edit
    // immediately above. Build this public list only after that mutation so
    // the first hydration never returns a stale differsFromBase projection.
    const workingCopies = [];
    for (const entry of loaded.manifest.workingCopies) {
      const workingCopyState = entry.workingCopyId === workingCopy?.workingCopyId
        ? state
        : await readJsonFile(
          workingCopyStatePath(loaded.paths, entry),
          "Working Copy state",
          { projectRootPath: loaded.paths.projectRootPath },
        );
      assertWorkingCopyState(workingCopyState, loaded, entry);
      workingCopies.push({
        workingCopyId: entry.workingCopyId,
        versionId: entry.versionId,
        basedOnVersionId: entry.basedOnVersionId,
        differsFromBase: workingCopyState.differsFromBase === true,
        saveState: workingCopyState.saveState,
      });
    }
    performanceTiming.checkpoint("workingCopyScanMs");
    const result = {
      target,
      project: structuredClone(loaded.project),
      manifest: structuredClone(loaded.manifest),
      runtime: structuredClone(loaded.runtime),
      workingCopy: workingCopy ? structuredClone(workingCopy) : null,
      workingCopyState: state ? structuredClone(state) : null,
      workingCopies: structuredClone(workingCopies),
      draft: draft ? structuredClone(draft) : null,
      activeRequest: loaded.runtime.activeRequest && activeRequest
        ? structuredClone(activeRequest)
        : null,
      activeCandidate: loaded.runtime.activeRequest && activeCandidate
        ? structuredClone(activeCandidate.candidate)
        : null,
      terminalRequest: terminalAiTask
        ? this.#publicRequest(terminalAiTask.record, loaded.paths.projectRootPath)
        : null,
      workingCopyRecovered,
      workingCopyIdentityMigrated,
      workingCopyIdentityAdopted,
      content: source.html,
      sourceSha256: source.sha256,
      lastModifiedAt: source.lastModifiedAt,
    };
    performanceTiming.checkpoint("workspaceSerializeMs");
    return result;
  }

  async #reconcileExternalWorkingCopyState({ loaded, workingCopy, state, source }) {
    assertWorkingCopyState(state, loaded, workingCopy);
    if (
      state.sourceElementIdentitySchemaVersion
        === STEMMIO_ELEMENT_ID_SCHEMA_VERSION
    ) {
      const identity = inspectSourceElementIdentity(source.html);
      const diskBindingSha256 = identity.complete
        ? sourceElementIdentityBindingSha256(identity)
        : null;
      if (diskBindingSha256 !== state.sourceElementIdentityBindingSha256) {
        throw new ProjectFileRepositoryError(
          "WORKING_COPY_CONFLICT",
          "The Working Copy source element identity bindings changed outside Stemmio.",
          {
            workingCopyId: workingCopy.workingCopyId,
            recordedSha256: state.currentSha256,
            diskSha256: source.sha256,
            recordedBindingSha256: state.sourceElementIdentityBindingSha256,
            diskBindingSha256,
          },
        );
      }
    }
    const recordedSha256 = String(state.currentSha256 || "");
    if (recordedSha256 === source.sha256) return { state, recovered: false };
    if (state.forceUnlockReceipt?.status === "pending") {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_CONFLICT",
        "The Working Copy changed while a force-unlock operation is still unresolved.",
        {
          workingCopyId: workingCopy.workingCopyId,
          recordedSha256,
          diskSha256: source.sha256,
          operationId: state.forceUnlockReceipt.operationId || null,
        },
      );
    }
    if (state.saveState !== "saved") {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_CONFLICT",
        "The Working Copy changed on disk while Stemmio still retains unsaved edits.",
        {
          workingCopyId: workingCopy.workingCopyId,
          recordedSha256,
          diskSha256: source.sha256,
          saveState: state.saveState || null,
        },
      );
    }
    const nextState = {
      ...state,
      schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      workingCopyId: workingCopy.workingCopyId,
      currentSha256: source.sha256,
      differsFromBase: source.sha256 !== state.baseSha256,
      saveState: "saved",
      lastOpenedAt: nowIso(this.#clock),
    };
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      workingCopyStatePath(loaded.paths, workingCopy),
      nextState,
      "Working Copy state",
    );
    return { state: nextState, recovered: true };
  }

  async #adoptExternalWorkingCopyState({ loaded, workingCopy, state, source }) {
    assertWorkingCopyState(state, loaded, workingCopy, {
      allowMissingIdentityBinding: true,
    });
    // Explicit force-unlock is the one user-authorized boundary that can
    // replace an identity-v1 Working Copy with arbitrary complete disk HTML.
    // Clear the marker before committing the adopted Hash so the shared
    // recoverable migration below can validate, adopt or materialize that
    // exact disk document instead of treating the intentional replacement as
    // silent identity loss.
    const adoptedState = { ...state };
    delete adoptedState.sourceElementIdentitySchemaVersion;
    delete adoptedState.sourceElementIdentityBindingSha256;
    const nextState = {
      ...adoptedState,
      schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      workingCopyId: workingCopy.workingCopyId,
      currentSha256: source.sha256,
      differsFromBase: source.sha256 !== state.baseSha256,
      // Remain unresolved until identity materialization passes its source
      // CAS. Ordinary workspace reconciliation must not adopt newer bytes in
      // this pending operation window.
      saveState: "saving",
      lastOpenedAt: nowIso(this.#clock),
      // lastPersistedRevision stays at the last successful Stemmio write.
      // Adopting disk bytes does not invent a new persisted edit. The
      // renderer then uses Math.max against its session revision so the
      // current window looks saved; a cold start hydrates from this disk
      // revision together with the adopted HTML.
    };
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      workingCopyStatePath(loaded.paths, workingCopy),
      nextState,
      "Working Copy state",
    );
    await this.#hit("force-unlock-adopted-state-written", {
      operationId: nextState.forceUnlockReceipt?.operationId || null,
      workingCopyId: workingCopy.workingCopyId,
    });
    return { state: nextState, recovered: true };
  }

  #assertSourceElementIdentityMigrationTransaction(loaded, transaction) {
    if (!isObject(transaction)) {
      throw new ProjectFileRepositoryError(
        "IDENTITY_MIGRATION_INVALID",
        "The source element identity migration record is missing.",
      );
    }
    const workingCopy = loaded.manifest.workingCopies.find(
      (entry) => entry.workingCopyId === transaction.workingCopyId,
    );
    if (
      transaction.schemaVersion
        !== SOURCE_ELEMENT_IDENTITY_MIGRATION_TRANSACTION_SCHEMA_VERSION
      || transaction.kind !== "source-element-identity-migration"
      || !["prepared", "committed"].includes(transaction.state)
      || transaction.projectId !== loaded.project.projectId
      || transaction.documentId !== loaded.project.documentId
      || !workingCopy
      || (transaction.state !== "committed" && transaction.sourceRelativePath !== workingCopy.sourceRelativePath)
      || transaction.identitySchemaVersion !== STEMMIO_ELEMENT_ID_SCHEMA_VERSION
      || !SHA256.test(String(transaction.expectedSourceSha256 || ""))
      || !SHA256.test(String(transaction.targetSourceSha256 || ""))
      || !Number.isSafeInteger(transaction.addedElementCount)
      || transaction.addedElementCount < 0
      || !validStateTimestamp(transaction.preparedAt)
      || (
        transaction.state === "committed"
        && (
          ![
            "migrated",
            "adopted-existing",
            "recovered",
            "rolled-back-incomplete-staging",
            "source-changed-before-cas",
            "external-superseded",
          ].includes(transaction.outcome)
          || !validStateTimestamp(transaction.committedAt)
        )
      )
    ) {
      throw new ProjectFileRepositoryError(
        "IDENTITY_MIGRATION_INVALID",
        "The source element identity migration does not match its Working Copy authority.",
        { workingCopyId: transaction.workingCopyId || null },
      );
    }
    const recoveryPaths = sourceElementIdentityMigrationRecoveryPaths(
      loaded.paths,
      workingCopy.workingCopyId,
      transaction.identitySchemaVersion,
      transaction.recoveryId,
    );
    const expectedPreviousRelativePath = path.relative(
      loaded.paths.projectRootPath,
      recoveryPaths.previousPath,
    ).replaceAll(path.sep, "/");
    const expectedNextRelativePath = path.relative(
      loaded.paths.projectRootPath,
      recoveryPaths.nextPath,
    ).replaceAll(path.sep, "/");
    if (
      transaction.previousRelativePath !== expectedPreviousRelativePath
      || transaction.nextRelativePath !== expectedNextRelativePath
    ) {
      throw new ProjectFileRepositoryError(
        "IDENTITY_MIGRATION_INVALID",
        "The source element identity migration recovery paths do not match its recovery ID.",
        { workingCopyId: transaction.workingCopyId },
      );
    }
    return { workingCopy, recoveryPaths };
  }

  async #commitSourceElementIdentityMetadata({
    loaded,
    workingCopy,
    state,
    source,
  }) {
    const identity = inspectSourceElementIdentity(source.html);
    if (!identity.complete) {
      throw new ProjectFileRepositoryError(
        "SOURCE_ELEMENT_IDENTITY_INVALID",
        "The migrated Working Copy does not have a complete source identity set.",
        { issues: identity.issues },
      );
    }
    await refreshSourceBinding(loaded.paths.projectRootPath, workingCopy.workingCopyId,
      workingCopySourcePath(loaded.paths, workingCopy), source.sha256);
    workingCopy.fileIdentity = copyFileIdentity(source.information);
    const nextState = {
      ...state,
      schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      workingCopyId: workingCopy.workingCopyId,
      currentSha256: source.sha256,
      differsFromBase: source.sha256 !== state.baseSha256,
      saveState: "saved",
      lastSavedAt: nowIso(this.#clock),
      sourceElementIdentitySchemaVersion: STEMMIO_ELEMENT_ID_SCHEMA_VERSION,
      sourceElementIdentityBindingSha256:
        sourceElementIdentityBindingSha256(identity),
    };
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      workingCopyStatePath(loaded.paths, workingCopy),
      nextState,
      "Working Copy state",
    );
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      loaded.paths.manifestPath,
      loaded.manifest,
      "manifest.json",
    );
    return nextState;
  }

  async #finishSourceElementIdentityMigration({
    loaded,
    transactionPath,
    transaction,
    recoveryPaths,
    outcome,
  }) {
    const current = await readJsonFile(
      transactionPath,
      "source element identity migration",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      transactionPath,
      {
        ...(current || transaction),
        state: "committed",
        outcome,
        committedAt: nowIso(this.#clock),
      },
      "source element identity migration",
    );
    await rm(recoveryPaths.operationRoot, { recursive: true, force: true }).catch(() => {});
    await syncDirectory(loaded.paths.recoveryRoot).catch(() => {});
    await retireOlderIdentityTransactions(
      loaded.paths,
      transaction.workingCopyId,
      transactionPath,
    );
  }

  async #completeRecoveredForceUnlock({
    loaded,
    workingCopy,
    state,
    source,
    acceptedSourceSha256,
  }) {
    const pending = state.forceUnlockReceipt;
    const identity = inspectSourceElementIdentity(source.html);
    const canComplete = pending?.status === "pending"
      && SAFE_OPERATION_ID.test(String(pending.operationId || ""))
      && pending.expectedSourceSha256 === acceptedSourceSha256
      && pending.acceptedSourceSha256 === acceptedSourceSha256
      && state.saveState === "saved"
      && state.currentSha256 === source.sha256
      && state.sourceElementIdentitySchemaVersion === STEMMIO_ELEMENT_ID_SCHEMA_VERSION
      && identity.complete
      && state.sourceElementIdentityBindingSha256
        === sourceElementIdentityBindingSha256(identity);
    if (!canComplete) return state;
    if (loaded.runtime.activeRequest) {
      loaded.runtime.activeRequest = null;
      loaded.runtime.activeCandidateId = null;
      await this.#writeRuntime(loaded);
    }
    const nextState = {
      ...state,
      forceUnlockReceipt: {
        status: "completed",
        operationId: pending.operationId,
        expectedSourceSha256: acceptedSourceSha256,
        acceptedSourceSha256,
        sourceSha256: source.sha256,
        completedAt: nowIso(this.#clock),
      },
    };
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      workingCopyStatePath(loaded.paths, workingCopy),
      nextState,
      "force-unlock receipt",
    );
    return nextState;
  }

  async #ensureSourceElementIdentity({ loaded, workingCopy, state, source }) {
    assertWorkingCopyState(state, loaded, workingCopy);
    const identity = inspectSourceElementIdentity(source.html);
    const alreadyMigrated = state.sourceElementIdentitySchemaVersion
      === STEMMIO_ELEMENT_ID_SCHEMA_VERSION;
    if (alreadyMigrated) {
      if (!identity.complete) {
        throw new ProjectFileRepositoryError(
          "SOURCE_ELEMENT_IDENTITY_LOST",
          "The Working Copy lost or corrupted its persistent source element identities.",
          { workingCopyId: workingCopy.workingCopyId, issues: identity.issues },
        );
      }
      return { source, state, migrated: false, adopted: false };
    }
    const pendingForceUnlock = state.saveState === "saving"
      && state.forceUnlockReceipt?.status === "pending"
      && SAFE_OPERATION_ID.test(String(state.forceUnlockReceipt.operationId || ""))
      && state.forceUnlockReceipt.expectedSourceSha256 === source.sha256
      && state.forceUnlockReceipt.acceptedSourceSha256 === source.sha256
      && state.currentSha256 === source.sha256;
    if (state.saveState !== "saved" && !pendingForceUnlock) {
      throw new ProjectFileRepositoryError(
        "IDENTITY_MIGRATION_BLOCKED",
        "The Working Copy identity cannot migrate while its save state is unresolved.",
        { workingCopyId: workingCopy.workingCopyId, saveState: state.saveState },
      );
    }
    const materialized = materializeSourceElementIdentity(source.html);
    const nextSha256 = sha256(materialized.buffer);
    const recoveryId = `identity_${workingCopy.workingCopyId}_v${STEMMIO_ELEMENT_ID_SCHEMA_VERSION}_${randomUUID().replaceAll("-", "")}`;
    const recoveryPaths = sourceElementIdentityMigrationRecoveryPaths(
      loaded.paths,
      workingCopy.workingCopyId,
      STEMMIO_ELEMENT_ID_SCHEMA_VERSION,
      recoveryId,
    );
    await ensureProjectDirectory(
      loaded.paths.projectRootPath,
      recoveryPaths.operationRoot,
      "source element identity recovery directory",
    );
    const transactionPath = path.join(loaded.paths.transactionsRoot, `${recoveryId}.json`);
    const transaction = {
      schemaVersion: SOURCE_ELEMENT_IDENTITY_MIGRATION_TRANSACTION_SCHEMA_VERSION,
      kind: "source-element-identity-migration",
      state: "prepared",
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      workingCopyId: workingCopy.workingCopyId,
      sourceRelativePath: workingCopy.sourceRelativePath,
      identitySchemaVersion: STEMMIO_ELEMENT_ID_SCHEMA_VERSION,
      expectedSourceSha256: source.sha256,
      targetSourceSha256: nextSha256,
      previousRelativePath: path.relative(
        loaded.paths.projectRootPath,
        recoveryPaths.previousPath,
      ).replaceAll(path.sep, "/"),
      nextRelativePath: path.relative(
        loaded.paths.projectRootPath,
        recoveryPaths.nextPath,
      ).replaceAll(path.sep, "/"),
      recoveryId,
      addedElementCount: materialized.addedElementCount,
      preparedAt: nowIso(this.#clock),
    };
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      transactionPath,
      transaction,
      "source element identity migration",
    );
    await atomicWriteProjectFile(
      loaded.paths.projectRootPath,
      recoveryPaths.previousPath,
      source.buffer,
      "source element identity previous bytes",
    );
    await atomicWriteProjectFile(
      loaded.paths.projectRootPath,
      recoveryPaths.nextPath,
      materialized.buffer,
      "source element identity replacement bytes",
    );
    await this.#hit("identity-migration-prepared", { transactionPath });

    let migratedSource = source;
    if (nextSha256 !== source.sha256) {
      const cas = await compareAndSwapWorkingCopyFile({
        sourcePath: workingCopySourcePath(loaded.paths, workingCopy),
        nextBuffer: materialized.buffer,
        expectedSha256: source.sha256,
        nextSha256,
        projectRootPath: loaded.paths.projectRootPath,
      });
      if (!cas.swapped) {
        await this.#finishSourceElementIdentityMigration({
          loaded,
          transactionPath,
          transaction,
          recoveryPaths,
          outcome: "source-changed-before-cas",
        });
        throw new ProjectFileRepositoryError(
          "WORKING_COPY_CONFLICT",
          "The Working Copy changed before its source element identity migration.",
          {
            workingCopyId: workingCopy.workingCopyId,
            expectedSourceSha256: source.sha256,
            actualSourceSha256: cas.actualSha256,
          },
        );
      }
      migratedSource = cas.written;
      await this.#hit("identity-migration-source-written", { transactionPath });
    }
    const nextState = await this.#commitSourceElementIdentityMetadata({
      loaded,
      workingCopy,
      state,
      source: migratedSource,
    });
    await this.#hit("identity-migration-metadata-written", { transactionPath });
    await this.#finishSourceElementIdentityMigration({
      loaded,
      transactionPath,
      transaction,
      recoveryPaths,
      outcome: materialized.changed ? "migrated" : "adopted-existing",
    });
    return {
      source: migratedSource,
      state: nextState,
      migrated: materialized.changed,
      adopted: !materialized.changed,
    };
  }

  async #recoverSourceElementIdentityMigration(
    loaded,
    transactionPath,
    transaction,
  ) {
    const { workingCopy, recoveryPaths } =
      this.#assertSourceElementIdentityMigrationTransaction(loaded, transaction);
    if (transaction.state === "committed") {
      await rm(recoveryPaths.operationRoot, { recursive: true, force: true }).catch(() => {});
      await retireOlderIdentityTransactions(
        loaded.paths,
        transaction.workingCopyId,
        transactionPath,
      );
      return {
        kind: "source-element-identity-migration",
        workingCopyId: workingCopy.workingCopyId,
        state: "committed-cleanup",
      };
    }

    const state = await readJsonFile(
      workingCopyStatePath(loaded.paths, workingCopy),
      "Working Copy state",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    assertWorkingCopyState(state, loaded, workingCopy);
    const sourcePath = workingCopySourcePath(loaded.paths, workingCopy);
    const source = await readHtmlFile(sourcePath, "Working Copy", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    const readRecoveryHtml = async (filePath, label) => {
      const information = await regularInformation(filePath, label, {
        projectRootPath: loaded.paths.projectRootPath,
      });
      if (!information) return null;
      return readHtmlFile(filePath, label, {
        projectRootPath: loaded.paths.projectRootPath,
      });
    };
    const [previous, next] = await Promise.all([
      readRecoveryHtml(
        recoveryPaths.previousPath,
        "source element identity previous bytes",
      ),
      readRecoveryHtml(
        recoveryPaths.nextPath,
        "source element identity replacement bytes",
      ),
    ]);
    if (previous && previous.sha256 !== transaction.expectedSourceSha256) {
      throw new ProjectFileRepositoryError(
        "IDENTITY_MIGRATION_INVALID",
        "The source element identity recovery bytes do not match the expected source Hash.",
      );
    }
    if (next && next.sha256 !== transaction.targetSourceSha256) {
      throw new ProjectFileRepositoryError(
        "IDENTITY_MIGRATION_INVALID",
        "The source element identity replacement bytes do not match the target Hash.",
      );
    }

    let migratedSource = source;
    if (source.sha256 === transaction.expectedSourceSha256) {
      if (!next) {
        await this.#finishSourceElementIdentityMigration({
          loaded,
          transactionPath,
          transaction,
          recoveryPaths,
          outcome: "rolled-back-incomplete-staging",
        });
        return {
          kind: "source-element-identity-migration",
          workingCopyId: workingCopy.workingCopyId,
          state: "rolled-back",
        };
      }
      if (transaction.targetSourceSha256 !== transaction.expectedSourceSha256) {
        const cas = await compareAndSwapWorkingCopyFile({
          sourcePath,
          nextBuffer: next.buffer,
          expectedSha256: transaction.expectedSourceSha256,
          nextSha256: transaction.targetSourceSha256,
          projectRootPath: loaded.paths.projectRootPath,
        });
        if (!cas.swapped) {
          throw new ProjectFileRepositoryError(
            "IDENTITY_MIGRATION_RECOVERY_CONFLICT",
            "The Working Copy changed while its identity migration was recovering.",
            {
              workingCopyId: workingCopy.workingCopyId,
              actualSourceSha256: cas.actualSha256,
            },
          );
        }
        migratedSource = cas.written;
      }
    } else if (source.sha256 !== transaction.targetSourceSha256) {
      const pendingForceUnlock = state.forceUnlockReceipt;
      if (
        pendingForceUnlock?.status === "pending"
        && SAFE_OPERATION_ID.test(String(pendingForceUnlock.operationId || ""))
        && pendingForceUnlock.expectedSourceSha256 === transaction.expectedSourceSha256
        && pendingForceUnlock.acceptedSourceSha256 === transaction.expectedSourceSha256
      ) {
        await this.#finishSourceElementIdentityMigration({
          loaded,
          transactionPath,
          transaction,
          recoveryPaths,
          outcome: "external-superseded",
        });
        return {
          kind: "source-element-identity-migration",
          workingCopyId: workingCopy.workingCopyId,
          state: "external-superseded",
          sourceSha256: source.sha256,
        };
      }
      throw new ProjectFileRepositoryError(
        "IDENTITY_MIGRATION_RECOVERY_CONFLICT",
        "The Working Copy no longer matches either complete side of its identity migration.",
        {
          workingCopyId: workingCopy.workingCopyId,
          expectedSourceSha256: transaction.expectedSourceSha256,
          targetSourceSha256: transaction.targetSourceSha256,
          actualSourceSha256: source.sha256,
        },
      );
    }
    let nextState = await this.#commitSourceElementIdentityMetadata({
      loaded,
      workingCopy,
      state,
      source: migratedSource,
    });
    nextState = await this.#completeRecoveredForceUnlock({
      loaded,
      workingCopy,
      state: nextState,
      source: migratedSource,
      acceptedSourceSha256: transaction.expectedSourceSha256,
    });
    await this.#finishSourceElementIdentityMigration({
      loaded,
      transactionPath,
      transaction,
      recoveryPaths,
      outcome: "recovered",
    });
    return {
      kind: "source-element-identity-migration",
      workingCopyId: workingCopy.workingCopyId,
      state: "recovered",
      sourceSha256: migratedSource.sha256,
      sourceElementIdentitySchemaVersion:
        nextState.sourceElementIdentitySchemaVersion,
    };
  }

  async #forceUnlockWorkingCopy({
    projectId,
    documentId,
    sourcePath,
    expectedSourceSha256,
    operationId,
  }) {
    const acceptedOperationId = String(operationId || "");
    if (!SAFE_OPERATION_ID.test(acceptedOperationId)) {
      throw new ProjectFileRepositoryError(
        "INVALID_OPERATION_ID",
        "The force-unlock operationId is invalid.",
      );
    }
    const acceptedProjectId = assertId(projectId, PROJECT_ID, "projectId");
    const acceptedDocumentId = assertId(documentId, DOCUMENT_ID, "documentId");
    const acceptedSourcePath = normalizedPath(sourcePath);
    const acceptedSourceSha256 = assertSha256(
      expectedSourceSha256,
      "expectedSourceSha256",
    );
    const target = await this.#resolveOpenTarget({
      sourcePath: acceptedSourcePath,
      readOnly: true,
    });
    if (!target) {
      throw new ProjectFileRepositoryError(
        "PROJECT_NOT_FOUND",
        "No Stemmio project is registered for this HTML.",
      );
    }
    if (
      target.projectId !== acceptedProjectId
      || target.documentId !== acceptedDocumentId
      || !samePath(target.exactSourcePath, acceptedSourcePath)
    ) {
      throw new ProjectFileRepositoryError(
        "SOURCE_IDENTITY_MISMATCH",
        "The force-unlock target no longer matches the confirmed document identity.",
      );
    }
    let preparedProject = await this.#loadRegisteredProject({
      projectId: target.projectId,
      documentId: target.documentId,
      declaredProjectRootPath: target.projectRootPath,
    });
    let preparedWorkingCopy = preparedProject.manifest.workingCopies.find(
      (entry) => entry.workingCopyId === target.workingCopyId,
    );
    if (!preparedWorkingCopy) {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_NOT_FOUND",
        "The force-unlock Working Copy no longer exists.",
      );
    }
    let preparedSource = await readHtmlFile(target.exactSourcePath, "managed HTML", {
      projectRootPath: preparedProject.paths.projectRootPath,
    });
    let preparedStatePath = workingCopyStatePath(
      preparedProject.paths,
      preparedWorkingCopy,
    );
    let preparedState = await readJsonFile(preparedStatePath, "Working Copy state", {
      projectRootPath: preparedProject.paths.projectRootPath,
    });
    assertWorkingCopyState(preparedState, preparedProject, preparedWorkingCopy, {
      allowMissingIdentityBinding: true,
    });
    if (preparedState.forceUnlockReceipt?.status === "pending") {
      const pendingOperationId = String(
        preparedState.forceUnlockReceipt.operationId || "",
      );
      const reconciled = await this.#queryForceUnlockWorkingCopy({
        projectId: acceptedProjectId,
        documentId: acceptedDocumentId,
        sourcePath: acceptedSourcePath,
        operationId: pendingOperationId,
      });
      if (pendingOperationId === acceptedOperationId) return reconciled;
      if (reconciled.status === "unknown") {
        throw new ProjectFileRepositoryError(
          "FORCE_UNLOCK_OPERATION_PENDING",
          "A previous force-unlock operation is still unresolved.",
          { operationId: pendingOperationId },
        );
      }
      preparedProject = await this.#loadRegisteredProject({
        projectId: target.projectId,
        documentId: target.documentId,
        declaredProjectRootPath: target.projectRootPath,
      });
      preparedWorkingCopy = preparedProject.manifest.workingCopies.find(
        (entry) => entry.workingCopyId === target.workingCopyId,
      );
      if (!preparedWorkingCopy) {
        throw new ProjectFileRepositoryError(
          "WORKING_COPY_NOT_FOUND",
          "The force-unlock Working Copy no longer exists.",
        );
      }
      preparedSource = await readHtmlFile(target.exactSourcePath, "managed HTML", {
        projectRootPath: preparedProject.paths.projectRootPath,
      });
      preparedStatePath = workingCopyStatePath(
        preparedProject.paths,
        preparedWorkingCopy,
      );
      preparedState = await readJsonFile(preparedStatePath, "Working Copy state", {
        projectRootPath: preparedProject.paths.projectRootPath,
      });
      assertWorkingCopyState(preparedState, preparedProject, preparedWorkingCopy, {
        allowMissingIdentityBinding: true,
      });
    }
    if (preparedSource.sha256 !== acceptedSourceSha256) {
      throw new ProjectFileRepositoryError(
        "SOURCE_HASH_CONFLICT",
        "The Working Copy changed after the external version was confirmed.",
        {
          expectedSourceSha256: acceptedSourceSha256,
          actualSourceSha256: preparedSource.sha256,
        },
      );
    }
    await atomicWriteProjectJson(
      preparedProject.paths.projectRootPath,
      preparedStatePath,
      {
        ...preparedState,
        forceUnlockReceipt: {
          status: "pending",
          operationId: acceptedOperationId,
          expectedSourceSha256: acceptedSourceSha256,
          acceptedSourceSha256,
          preparedAt: nowIso(this.#clock),
        },
      },
      "pending force-unlock receipt",
    );
    await this.#hit("force-unlock-pending-receipt-written", {
      operationId: acceptedOperationId,
      projectId: acceptedProjectId,
      documentId: acceptedDocumentId,
    });
    const workspace = await this.#workspace({
      sourcePath: acceptedSourcePath,
      adoptExternalConflict: true,
      expectedProjectId: acceptedProjectId,
      expectedDocumentId: acceptedDocumentId,
      expectedExternalSha256: acceptedSourceSha256,
    });
    if (!workspace) {
      throw new ProjectFileRepositoryError(
        "PROJECT_NOT_FOUND",
        "No Stemmio project is registered for this HTML.",
      );
    }
    const result = {
      status: "force-unlocked",
      operationId: acceptedOperationId,
      acceptedSourceSha256,
      projectId: workspace.project.projectId,
      documentId: workspace.project.documentId,
      sourcePath: workspace.target.exactSourcePath,
      sourceSha256: workspace.sourceSha256,
      sha256: workspace.sourceSha256,
      content: workspace.content,
      lastModifiedAt: workspace.lastModifiedAt,
      workingCopyState: workspace.workingCopyState,
    };
    await this.#hit("force-unlock-before-completed-receipt", {
      operationId: acceptedOperationId,
      projectId: workspace.project.projectId,
      documentId: workspace.project.documentId,
    });
    const loaded = await this.#loadRegisteredProject({
      projectId: workspace.project.projectId,
      documentId: workspace.project.documentId,
      declaredProjectRootPath: workspace.target.projectRootPath,
    });
    const workingCopy = loaded.manifest.workingCopies.find(
      (entry) => entry.workingCopyId === workspace.target.workingCopyId,
    );
    if (!workingCopy) {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_NOT_FOUND",
        "The force-unlock Working Copy no longer exists.",
      );
    }
    const statePath = workingCopyStatePath(loaded.paths, workingCopy);
    const state = await readJsonFile(statePath, "Working Copy state", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    assertWorkingCopyState(state, loaded, workingCopy);
    const receipt = {
      status: "completed",
      operationId: acceptedOperationId,
      expectedSourceSha256: acceptedSourceSha256,
      acceptedSourceSha256,
      sourceSha256: workspace.sourceSha256,
      completedAt: nowIso(this.#clock),
    };
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      statePath,
      { ...state, forceUnlockReceipt: receipt },
      "force-unlock receipt",
    );
    return result;
  }

  async #queryForceUnlockWorkingCopy({
    projectId,
    documentId,
    sourcePath,
    operationId,
  }) {
    const acceptedOperationId = String(operationId || "");
    if (!SAFE_OPERATION_ID.test(acceptedOperationId)) {
      throw new ProjectFileRepositoryError(
        "INVALID_OPERATION_ID",
        "The force-unlock operationId is invalid.",
      );
    }
    const expectedProjectId = assertId(projectId, PROJECT_ID, "projectId");
    const expectedDocumentId = assertId(documentId, DOCUMENT_ID, "documentId");
    const expectedSourcePath = normalizedPath(sourcePath);
    const target = await this.#resolveOpenTarget({
      sourcePath: expectedSourcePath,
      readOnly: true,
    });
    if (!target) {
      throw new ProjectFileRepositoryError(
        "PROJECT_NOT_FOUND",
        "No Stemmio project is registered for this HTML.",
      );
    }
    if (
      target.projectId !== expectedProjectId
      || target.documentId !== expectedDocumentId
      || !samePath(target.exactSourcePath, expectedSourcePath)
    ) {
      throw new ProjectFileRepositoryError(
        "SOURCE_IDENTITY_MISMATCH",
        "The force-unlock result target no longer matches the confirmed document identity.",
      );
    }
    await this.#recoverProject(target.projectRootPath);
    const loaded = await this.#loadRegisteredProject({
      projectId: target.projectId,
      documentId: target.documentId,
      declaredProjectRootPath: target.projectRootPath,
    });
    const workingCopy = loaded.manifest.workingCopies.find(
      (entry) => entry.workingCopyId === target.workingCopyId,
    );
    if (!workingCopy) {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_NOT_FOUND",
        "The force-unlock Working Copy no longer exists.",
      );
    }
    let state = await readJsonFile(
      workingCopyStatePath(loaded.paths, workingCopy),
      "Working Copy state",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    assertWorkingCopyState(state, loaded, workingCopy);
    let receipt = state.forceUnlockReceipt;
    if (!receipt || receipt.operationId !== acceptedOperationId) {
      return {
        status: "unknown",
        operationId: acceptedOperationId,
        projectId: target.projectId,
        documentId: target.documentId,
        sourcePath: target.exactSourcePath,
      };
    }
    let source = await readHtmlFile(target.exactSourcePath, "managed HTML", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (receipt.status === "superseded") {
      return {
        status: "superseded",
        operationId: acceptedOperationId,
        projectId: target.projectId,
        documentId: target.documentId,
        sourcePath: target.exactSourcePath,
        sourceSha256: source.sha256,
      };
    }
    if (receipt.status === "pending") {
      state = await this.#completeRecoveredForceUnlock({
        loaded,
        workingCopy,
        state,
        source,
        acceptedSourceSha256: String(receipt.acceptedSourceSha256 || ""),
      });
      receipt = state.forceUnlockReceipt;
    }
    if (receipt?.status === "pending") {
      if (source.sha256 !== receipt.acceptedSourceSha256) {
        const supersededReceipt = {
          ...receipt,
          status: "superseded",
          sourceSha256: source.sha256,
          completedAt: nowIso(this.#clock),
        };
        state = { ...state, forceUnlockReceipt: supersededReceipt };
        await atomicWriteProjectJson(
          loaded.paths.projectRootPath,
          workingCopyStatePath(loaded.paths, workingCopy),
          state,
          "superseded force-unlock receipt",
        );
        receipt = supersededReceipt;
        return {
          status: "superseded",
          operationId: acceptedOperationId,
          projectId: target.projectId,
          documentId: target.documentId,
          sourcePath: target.exactSourcePath,
          sourceSha256: source.sha256,
        };
      }
      const resumed = await this.#workspace({
        sourcePath: target.exactSourcePath,
        adoptExternalConflict: true,
        expectedProjectId: target.projectId,
        expectedDocumentId: target.documentId,
        expectedExternalSha256: receipt.acceptedSourceSha256,
      });
      if (!resumed) {
        return {
          status: "unknown",
          operationId: acceptedOperationId,
          projectId: target.projectId,
          documentId: target.documentId,
          sourcePath: target.exactSourcePath,
        };
      }
      const resumedLoaded = await this.#loadRegisteredProject({
        projectId: target.projectId,
        documentId: target.documentId,
        declaredProjectRootPath: target.projectRootPath,
      });
      const resumedWorkingCopy = resumedLoaded.manifest.workingCopies.find(
        (entry) => entry.workingCopyId === target.workingCopyId,
      );
      if (!resumedWorkingCopy) {
        throw new ProjectFileRepositoryError(
          "WORKING_COPY_NOT_FOUND",
          "The force-unlock Working Copy no longer exists.",
        );
      }
      source = await readHtmlFile(target.exactSourcePath, "managed HTML", {
        projectRootPath: resumedLoaded.paths.projectRootPath,
      });
      state = await readJsonFile(
        workingCopyStatePath(resumedLoaded.paths, resumedWorkingCopy),
        "Working Copy state",
        { projectRootPath: resumedLoaded.paths.projectRootPath },
      );
      state = await this.#completeRecoveredForceUnlock({
        loaded: resumedLoaded,
        workingCopy: resumedWorkingCopy,
        state,
        source,
        acceptedSourceSha256: String(receipt.acceptedSourceSha256 || ""),
      });
      receipt = state.forceUnlockReceipt;
    }
    if (receipt.status === "completed" && source.sha256 !== receipt.sourceSha256) {
      return {
        status: "superseded",
        operationId: acceptedOperationId,
        projectId: target.projectId,
        documentId: target.documentId,
        sourcePath: target.exactSourcePath,
        sourceSha256: source.sha256,
      };
    }
    const identity = inspectSourceElementIdentity(source.html);
    const completed = receipt.status === "completed" || Boolean(
      receipt.status === "pending"
      && state.saveState === "saved"
      && state.currentSha256 === source.sha256
      && loaded.runtime.activeRequest === null
      && state.sourceElementIdentitySchemaVersion === STEMMIO_ELEMENT_ID_SCHEMA_VERSION
      && identity.complete
      && state.sourceElementIdentityBindingSha256
        === sourceElementIdentityBindingSha256(identity),
    );
    if (!completed) {
      return {
        status: "unknown",
        operationId: acceptedOperationId,
        projectId: target.projectId,
        documentId: target.documentId,
        sourcePath: target.exactSourcePath,
      };
    }
    return {
      status: "force-unlocked",
      operationId: acceptedOperationId,
      acceptedSourceSha256: String(receipt.acceptedSourceSha256 || ""),
      projectId: target.projectId,
      documentId: target.documentId,
      sourcePath: target.exactSourcePath,
      sourceSha256: source.sha256,
      sha256: source.sha256,
      content: source.html,
      lastModifiedAt: source.lastModifiedAt,
      workingCopyState: state,
    };
  }

  async #prepareRequest({
    target,
    requestId,
    attemptId,
    expectedSourceSha256,
    request,
    prompt,
  }) {
    const loaded = await this.#resolveMutationTarget(target);
    const id = String(requestId || "");
    if (!SAFE_REQUEST_ID.test(id)) {
      throw new ProjectFileRepositoryError("INVALID_REQUEST_ID", "requestId is invalid.");
    }
    const attempt = String(attemptId || "attempt_001");
    if (!SAFE_REQUEST_ID.test(attempt)) {
      throw new ProjectFileRepositoryError("INVALID_ATTEMPT_ID", "attemptId is invalid.");
    }
    const expected = assertSha256(expectedSourceSha256, "expectedSourceSha256");
    if (loaded.source.sha256 !== expected) {
      throw new ProjectFileRepositoryError(
        "SOURCE_HASH_CONFLICT",
        "The Working Copy changed before this Request was frozen.",
        { expectedSourceSha256: expected, actualSourceSha256: loaded.source.sha256 },
      );
    }
    const active = loaded.runtime.activeRequest;
    if (active && active.requestId !== id) {
      throw new ProjectFileRepositoryError(
        "ACTIVE_REQUEST_EXISTS",
        "Another AI Request is still active for this Working Copy.",
        { activeRequestId: active.requestId },
      );
    }
    const submissionReceipt = request?.submissionOperationId
      ? await readSubmissionReceipt(loaded, request.submissionOperationId) : null;
    if (request?.submissionOperationId && (!submissionReceipt
      || submissionReceipt.requestId !== id || submissionReceipt.status === "not-started"
      || submissionReceipt.snapshot.sourceSha256 !== expected
      || JSON.stringify(submissionReceipt.snapshot.comments) !== JSON.stringify(request.comments || []))) {
      throw new ProjectFileRepositoryError("SUBMISSION_SNAPSHOT_CHANGED", "Submission does not authorize these frozen requirements.");
    }
    const requestRoot = requestRootPath(loaded.paths, id);
    await this.#recoverRequestFreezeForId(loaded, id);
    const requestPath = path.join(requestRoot, "request.json");
    const existing = await readJsonFile(requestPath, "request.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (existing) {
      this.#assertRequestRecord(existing, loaded, { requestId: id, attemptId: attempt });
      if (existing.expectedSourceSha256 !== expected) {
        throw new ProjectFileRepositoryError(
          "REQUEST_COLLISION",
          "This Request id belongs to another frozen source state.",
        );
      }
      await this.#restoreRequestRuntime(loaded, existing);
      await this.#publishAiTaskProjectionIfPossible({
        target,
        requestId: id,
        attemptId: attempt,
        candidateId: existing.candidateId,
      });
      return this.#publicRequest(existing, loaded.paths.projectRootPath);
    }
    if (await directoryInformation(
      requestRoot,
      "Request directory",
      { projectRootPath: loaded.paths.projectRootPath },
    )) {
      throw new ProjectFileRepositoryError(
        "REQUEST_COLLISION",
        "This Request id is occupied by an incomplete or incompatible Request directory.",
        { requestId: id },
      );
    }
    const stagingRoot = requestFreezeStagingRootPath(loaded.paths, id);
    const markerPath = requestFreezeMarkerPath(loaded.paths, id);
    let requestPublished = false;
    const latest = loaded.manifest.versions.find(
      (version) => version.versionId === loaded.manifest.latestOfficialVersionId,
    );
    const workingState = await readJsonFile(
      workingCopyStatePath(loaded.paths, loaded.workingCopy),
      "Working Copy state",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    assertWorkingCopyState(workingState, loaded, loaded.workingCopy);
    const requestInput = isObject(request) ? structuredClone(request) : null;
    let taskSpec;
    try {
      if (!requestInput || !Object.hasOwn(requestInput, "taskSpec")) {
        throw Object.assign(new TypeError("Request requires a complete Task Spec."), {
          code: "TASK_SPEC_REQUIRED",
        });
      }
      taskSpec = assertTaskSpec(requestInput.taskSpec, { requireAttachmentResolution: false });
    } catch (cause) {
      throw new ProjectFileRepositoryError(
        "TASK_SPEC_INVALID",
        "The Request Task Spec is invalid.",
        { reasonCode: cause?.code || "TASK_SPEC_INVALID" },
      );
    }
    const frozenRequest = {
      ...(submissionReceipt ? { submissionOperationId: submissionReceipt.operationId } : {}),
      freezeCutoffRevision: Number(requestInput.freezeCutoffRevision || 0),
      summary: taskSpec.objective,
      taskSpec,
      comments: Array.isArray(requestInput.comments) ? requestInput.comments : [],
      changeEvents: Array.isArray(requestInput.changeEvents) ? requestInput.changeEvents : [],
      agentDelivery: requestInput.agentDelivery || { mode: "clipboard" },
      ...(requestInput.handoffMessage
        ? { handoffMessage: String(requestInput.handoffMessage) }
        : {}),
    };
    try {
      frozenRequest.agentDelivery = this.#normalizeNewAgentDelivery(
        frozenRequest.agentDelivery || { mode: "clipboard" },
      );
    } catch (cause) {
      throw new ProjectFileRepositoryError(
        "AGENT_DELIVERY_INVALID",
        "The Request Agent delivery policy is invalid.",
        { reasonCode: cause?.code || "AGENT_DELIVERY_INVALID" },
      );
    }
    const freezeCutoffRevision = Number(frozenRequest.freezeCutoffRevision || 0);
    if (
      !Number.isSafeInteger(freezeCutoffRevision)
      || freezeCutoffRevision < 0
      || freezeCutoffRevision > Number(workingState?.lastPersistedRevision || 0)
    ) {
      throw new ProjectFileRepositoryError(
        "FREEZE_REVISION_NOT_PERSISTED",
        "The Request freeze revision has not been durably saved to its Working Copy.",
        {
          freezeCutoffRevision,
          lastPersistedRevision: Number(workingState?.lastPersistedRevision || 0),
        },
      );
    }
    try {
    const frozenCommentAttachments = await freezeRequestCommentAttachments({
      projectRootPath: loaded.paths.projectRootPath,
      requestRoot: stagingRoot,
      publicRequestRoot: requestRoot,
      requestId: id,
      comments: frozenRequest.comments,
    });
    if (frozenCommentAttachments.attachments.length > 0) {
      frozenRequest.comments = frozenCommentAttachments.comments;
      await this.#hit("request-attachments-written", {
        requestId: id,
        requestRoot,
        attachmentCount: frozenCommentAttachments.attachments.length,
      });
    }
    try {
      frozenRequest.taskSpec = assertTaskSpec({
        ...frozenRequest.taskSpec,
        attachments: frozenCommentAttachments.attachments,
      });
    } catch (cause) {
      throw new ProjectFileRepositoryError(
        "TASK_SPEC_INVALID",
        "The frozen Request attachments do not match the Task Spec.",
        { reasonCode: cause?.code || "TASK_SPEC_INVALID" },
      );
    }
    const ordinal = latest.ordinal + 1;
    const proposedVersionId = versionId(ordinal);
    const idForCandidate = candidateIdForRequest(loaded.project.projectId, id);
    const inputRoot = path.join(stagingRoot, "input", "base");
    const inputPath = path.join(inputRoot, "index.html");
    const annotationsPath = path.join(stagingRoot, "input", "annotations", "records.json");
    const projectRulesPath = path.join(stagingRoot, "input", "PROJECT.md");
    const aiRulesPath = path.join(stagingRoot, "input", "AI_RULES.md");
    const changeRequestPath = path.join(stagingRoot, "change-request.json");
    const inputManifestPath = path.join(stagingRoot, "input-manifest.json");
    const promptPath = path.join(stagingRoot, "PROMPT.md");
    const stagingRequestPath = path.join(stagingRoot, "request.json");
    const outputRelativePath = `requests/${id}/attempts/${attempt}/output/candidate.html`;
    const outputPath = path.join(stagingRoot, "attempts", attempt, "output", "candidate.html");
    const { filePath: projectNotesPath } =
      await ensureProjectRulesFile(loaded.paths.projectRootPath);
    const projectNotesBuffer = await readFile(projectNotesPath);
    if (submissionReceipt && sha256(projectNotesBuffer) !== submissionReceipt.snapshot.projectRulesSha256) {
      throw new ProjectFileRepositoryError("SUBMISSION_RULES_CHANGED", "Project rules changed after submission; create a new submission.");
    }
    const promptBuffer = Buffer.from(
      `${String(prompt || "")}${frozenCommentAttachments.promptAppendix}`,
      "utf8",
    );
    const aiRulesBuffer = Buffer.from(FROZEN_REQUEST_RULES, "utf8");
    const annotationsBuffer = Buffer.from(jsonText({
      schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      requestId: id,
      attemptId: attempt,
      sourceWorkingCopyId: loaded.workingCopy.workingCopyId,
      basedOnVersionId: loaded.workingCopy.basedOnVersionId,
      freezeCutoffRevision,
      comments: Array.isArray(frozenRequest.comments)
        ? frozenRequest.comments
        : [],
      changeEvents: Array.isArray(frozenRequest.changeEvents)
        ? frozenRequest.changeEvents
        : [],
      targets: Array.isArray(frozenRequest.taskSpec.targets)
        ? frozenRequest.taskSpec.targets
        : [],
    }), "utf8");
    const changeRequestBuffer = Buffer.from(jsonText({
      schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      policyVersion: FROZEN_REQUEST_POLICY_VERSION,
      promptTemplateVersion: FROZEN_REQUEST_PROMPT_TEMPLATE_VERSION,
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      requestId: id,
      attemptId: attempt,
      sourceWorkingCopyId: loaded.workingCopy.workingCopyId,
      expectedSourceSha256: expected,
      proposedVersionId,
      proposedVersionOrdinal: ordinal,
      basedOnVersionId: loaded.workingCopy.basedOnVersionId,
      previousVersionId: latest.versionId,
      freezeCutoffRevision,
      requirements: frozenRequest.taskSpec,
    }), "utf8");
    const inputManifestRelativePath = `requests/${id}/input-manifest.json`;
    const inputManifest = {
      schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      requestId: id,
      attemptId: attempt,
      frozen: true,
      readOrder: [
        "PROMPT.md",
        "input/AI_RULES.md",
        "change-request.json",
        "input/PROJECT.md",
        "input/base/index.html",
        "input/annotations/records.json",
        ...frozenCommentAttachments.manifestFiles.map((entry) => entry.path),
      ],
      files: [
        requestInputFileRecord("PROMPT.md", "prompt", "text/markdown", promptBuffer),
        requestInputFileRecord("input/AI_RULES.md", "policy", "text/markdown", aiRulesBuffer),
        requestInputFileRecord("change-request.json", "change-request", "application/json", changeRequestBuffer),
        requestInputFileRecord("input/PROJECT.md", "project-rules", "text/markdown", projectNotesBuffer),
        requestInputFileRecord("input/base/index.html", "base-html", "text/html", loaded.source.buffer),
        requestInputFileRecord("input/annotations/records.json", "annotations", "application/json", annotationsBuffer),
        ...frozenCommentAttachments.manifestFiles,
      ],
    };
    const inputManifestBuffer = Buffer.from(jsonText(inputManifest), "utf8");
    const record = {
      schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      requestId: id,
      attemptId: attempt,
      candidateId: idForCandidate,
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      sourceWorkingCopyId: loaded.workingCopy.workingCopyId,
      expectedSourceSha256: expected,
      proposedVersionId,
      proposedVersionOrdinal: ordinal,
      basedOnVersionId: loaded.workingCopy.basedOnVersionId,
      previousVersionId: latest.versionId,
      inputRelativePath: `requests/${id}/input/base/index.html`,
      promptRelativePath: `requests/${id}/PROMPT.md`,
      projectRulesRelativePath: `requests/${id}/input/PROJECT.md`,
      annotationsRelativePath: `requests/${id}/input/annotations/records.json`,
      changeRequestRelativePath: `requests/${id}/change-request.json`,
      inputManifestRelativePath,
      inputManifestSha256: sha256(inputManifestBuffer),
      outputRelativePath,
      status: "processing",
      createdAt: nowIso(this.#clock),
      policyVersion: FROZEN_REQUEST_POLICY_VERSION,
      promptTemplateVersion: FROZEN_REQUEST_PROMPT_TEMPLATE_VERSION,
      request: frozenRequest,
    };
    await ensureProjectDirectory(
      loaded.paths.projectRootPath,
      path.dirname(inputPath),
      "Request input directory",
    );
    await writeFileNoReplace(inputPath, loaded.source.buffer, expected, "Request input HTML", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    await this.#hit("request-input-written", { requestId: id, requestRoot });
    await ensureProjectDirectory(
      loaded.paths.projectRootPath,
      path.dirname(projectRulesPath),
      "Request project rules directory",
    );
    await writeFileNoReplace(projectRulesPath, projectNotesBuffer, sha256(projectNotesBuffer), "Request project rules", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    await writeFileNoReplace(aiRulesPath, aiRulesBuffer, sha256(aiRulesBuffer), "Request AI rules", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    await this.#hit("request-project-rules-written", { requestId: id, requestRoot });
    await ensureProjectDirectory(
      loaded.paths.projectRootPath,
      path.dirname(annotationsPath),
      "Request annotations directory",
    );
    await writeFileNoReplace(annotationsPath, annotationsBuffer, sha256(annotationsBuffer), "Request annotations", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    await this.#hit("request-annotations-written", { requestId: id, requestRoot });
    await writeFileNoReplace(changeRequestPath, changeRequestBuffer, sha256(changeRequestBuffer), "Request change record", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    await this.#hit("request-change-record-written", { requestId: id, requestRoot });
    await ensureProjectDirectory(
      loaded.paths.projectRootPath,
      path.dirname(outputPath),
      "Request output directory",
    );
    await writeFileNoReplace(promptPath, promptBuffer, sha256(promptBuffer), "Request prompt", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    await this.#hit("request-prompt-written", { requestId: id, requestRoot });
    await writeFileNoReplace(
      inputManifestPath,
      inputManifestBuffer,
      sha256(inputManifestBuffer),
      "Request input manifest",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    await this.#hit("request-input-manifest-written", { requestId: id, requestRoot });
    // Freezing the Request can span several durable writes. Re-read the
    // Working Copy at the publication boundary so a concurrent external edit
    // cannot turn the already-frozen, stale buffer into an active Request.
    const sourceBeforePublish = await readHtmlFile(loaded.exactSourcePath, "Working Copy", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (sourceBeforePublish.sha256 !== expected) {
      throw new ProjectFileRepositoryError(
        "SOURCE_HASH_CONFLICT",
        "The Working Copy changed while this Request was being frozen.",
        { expectedSourceSha256: expected, actualSourceSha256: sourceBeforePublish.sha256 },
      );
    }
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      stagingRequestPath,
      record,
      "request.json",
    );
    await this.#hit("request-record-written", { requestId: id, requestRoot });
    const freezeMarker = {
      schemaVersion: REQUEST_FREEZE_RECOVERY_SCHEMA_VERSION,
      kind: "request-freeze",
      state: "ready",
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      sourceWorkingCopyId: loaded.workingCopy.workingCopyId,
      requestId: id,
      attemptId: attempt,
      expectedSourceSha256: expected,
      requestRecordSha256: sha256(Buffer.from(jsonText(record), "utf8")),
      inputManifestSha256: record.inputManifestSha256,
      preparedAt: nowIso(this.#clock),
    };
    await this.#verifyRequestFreezeBundle({
      loaded,
      root: stagingRoot,
      marker: freezeMarker,
    });
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      markerPath,
      freezeMarker,
      "Request freeze recovery marker",
    );
    await this.#hit("request-freeze-ready", { requestId: id, requestRoot });
    await rename(stagingRoot, requestRoot);
    requestPublished = true;
    await this.#hit("request-published", { requestId: id, requestRoot });
    await syncDirectory(loaded.paths.requestsRoot);
    loaded.runtime.activeRequest = {
      requestId: id,
      candidateId: null,
      attemptId: attempt,
      status: "processing",
      // The external Agent can write inside its Request tree, but this
      // Runtime anchor remains outside it. The finalizer compares this digest
      // before trusting any Request-owned manifest or frozen input.
      inputManifestSha256: record.inputManifestSha256,
      candidateOutputSha256: null,
      candidateRecordSha256: null,
    };
    loaded.runtime.activeCandidateId = null;
    loaded.runtime.lastAiTask = null;
    await this.#writeRuntime(loaded);
    await this.#hit("request-runtime-written", { requestId: id, requestRoot });
    await unlink(markerPath).catch(() => {});
    await syncDirectory(path.dirname(markerPath)).catch(() => {});
    await this.#publishAiTaskProjectionIfPossible({
      target,
      requestId: id,
      attemptId: attempt,
      candidateId: idForCandidate,
    });
    await this.#hit("request-prepared", { requestId: id, requestRoot });
    return this.#publicRequest(record, loaded.paths.projectRootPath);
    } catch (cause) {
      if (!requestPublished) {
        await this.#cleanupRequestFreezeForId(loaded, id);
      }
      throw cause;
    }
  }

  async #cleanupRequestFreezeForId(loaded, requestId) {
    const stagingRoot = requestFreezeStagingRootPath(loaded.paths, requestId);
    const markerPath = requestFreezeMarkerPath(loaded.paths, requestId);
    const staging = await directoryInformation(
      stagingRoot,
      "Request freeze staging directory",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (staging) {
      await rm(stagingRoot, { recursive: true, force: true });
    }
    const marker = await regularInformation(
      markerPath,
      "Request freeze recovery marker",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (marker) await unlink(markerPath);
    await syncDirectory(path.dirname(stagingRoot)).catch(() => {});
  }

  async #verifyRequestFreezeTree({ root, projectRootPath, relativePath = "", files = new Set() }) {
    const currentPath = relativePath
      ? path.join(root, ...relativePath.split("/"))
      : root;
    const current = await directoryInformation(
      currentPath,
      "Request freeze directory",
      { projectRootPath },
    );
    if (!current) {
      throw requestFreezeRecoveryError(
        "The Request freeze directory disappeared during recovery.",
        { root, relativePath },
      );
    }
    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
      const entryRelativePath = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;
      const entryPath = path.join(currentPath, entry.name);
      if (entry.isSymbolicLink()) {
        throw requestFreezeRecoveryError(
          "The Request freeze contains a symbolic link.",
          { path: entryRelativePath },
        );
      }
      if (entry.isDirectory()) {
        await this.#verifyRequestFreezeTree({
          root,
          projectRootPath,
          relativePath: entryRelativePath,
          files,
        });
        continue;
      }
      if (!entry.isFile()) {
        throw requestFreezeRecoveryError(
          "The Request freeze contains an unsupported filesystem entry.",
          { path: entryRelativePath },
        );
      }
      await regularInformation(
        entryPath,
        "Request freeze file",
        { projectRootPath },
      );
      files.add(entryRelativePath);
    }
    return files;
  }

  #assertRequestFreezeMarker(marker, loaded, requestId) {
    const markerId = String(requestId || "");
    if (
      !isObject(marker)
      || marker.schemaVersion !== REQUEST_FREEZE_RECOVERY_SCHEMA_VERSION
      || marker.kind !== "request-freeze"
      || marker.state !== "ready"
      || marker.projectId !== loaded.project.projectId
      || marker.documentId !== loaded.project.documentId
      || marker.requestId !== markerId
      || !SAFE_REQUEST_ID.test(String(marker.attemptId || ""))
      || !validStateTimestamp(marker.preparedAt)
    ) {
      throw requestFreezeRecoveryError(
        "The Request freeze recovery marker has invalid identity or state.",
        { requestId: markerId },
      );
    }
    for (const [value, label] of [
      [marker.expectedSourceSha256, "expectedSourceSha256"],
      [marker.requestRecordSha256, "requestRecordSha256"],
      [marker.inputManifestSha256, "inputManifestSha256"],
    ]) {
      try {
        assertSha256(value, `Request freeze marker ${label}`);
      } catch (cause) {
        throw requestFreezeRecoveryError(
          "The Request freeze recovery marker contains an invalid hash.",
          { requestId: markerId, label, cause: cause?.code || null },
        );
      }
    }
    if (
      !SAFE_REQUEST_ID.test(markerId)
      || !WORKING_COPY_ID.test(String(marker.sourceWorkingCopyId || ""))
    ) {
      throw requestFreezeRecoveryError(
        "The Request freeze recovery marker is missing a safe Working Copy identity.",
        { requestId: markerId },
      );
    }
    return marker;
  }

  async #verifyRequestFreezeBundle({ loaded, root, marker }) {
    const requestId = String(marker?.requestId || "");
    const attemptId = String(marker?.attemptId || "");
    this.#assertRequestFreezeMarker(marker, loaded, requestId);
    const workingCopy = loaded.manifest.workingCopies.find(
      (entry) => entry.workingCopyId === marker.sourceWorkingCopyId,
    );
    if (!workingCopy) {
      throw requestFreezeRecoveryError(
        "The Request freeze marker names an unknown Working Copy.",
        { requestId, sourceWorkingCopyId: marker.sourceWorkingCopyId },
      );
    }
    const currentSource = await readHtmlFile(
      workingCopySourcePath(loaded.paths, workingCopy),
      "Working Copy during Request freeze recovery",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (currentSource.sha256 !== assertSha256(marker.expectedSourceSha256, "marker source hash")) {
      throw new ProjectFileRepositoryError(
        "SOURCE_HASH_CONFLICT",
        "The Working Copy changed before the staged Request could be recovered.",
        {
          requestId,
          expectedSourceSha256: marker.expectedSourceSha256,
          actualSourceSha256: currentSource.sha256,
        },
      );
    }
    const loadedWithWorkingCopy = { ...loaded, workingCopy };
    const fail = (message, details = {}) => {
      throw requestFreezeRecoveryError(message, { requestId, ...details });
    };
    const readJsonWithHash = async (filePath, label) => {
      try {
        return await readJsonFileWithSha256(filePath, label, {
          projectRootPath: loaded.paths.projectRootPath,
        });
      } catch (cause) {
        fail(
          `The Request freeze ${label} could not be read safely.`,
          { cause: cause?.code || null },
        );
      }
      return null;
    };
    const readManifestFile = async (relativePath, entry) => {
      const filePath = path.join(root, ...relativePath.split("/"));
      try {
        const result = await readRegularFileWithSha256(
          filePath,
          `Request freeze ${relativePath}`,
          { projectRootPath: loaded.paths.projectRootPath },
        );
        if (
          !result
          || result.buffer.byteLength !== entry.byteLength
          || result.sha256 !== entry.sha256
        ) {
          fail(
            "A Request freeze file does not match its input manifest.",
            { path: relativePath },
          );
        }
        return result;
      } catch (cause) {
        if (cause?.code === "REQUEST_FREEZE_RECOVERY_INVALID") throw cause;
        fail(
          `The Request freeze file ${relativePath} could not be verified.`,
          { path: relativePath, cause: cause?.code || null },
        );
      }
      return null;
    };
    const expectedRequestPaths = {
      inputRelativePath: `requests/${requestId}/input/base/index.html`,
      promptRelativePath: `requests/${requestId}/PROMPT.md`,
      projectRulesRelativePath: `requests/${requestId}/input/PROJECT.md`,
      annotationsRelativePath: `requests/${requestId}/input/annotations/records.json`,
      changeRequestRelativePath: `requests/${requestId}/change-request.json`,
      inputManifestRelativePath: `requests/${requestId}/input-manifest.json`,
      outputRelativePath: `requests/${requestId}/attempts/${attemptId}/output/candidate.html`,
    };
    const requestFile = await readJsonWithHash(
      path.join(root, "request.json"),
      "request.json",
    );
    if (!requestFile) fail("The Request freeze has no request.json.");
    if (requestFile.sha256 !== assertSha256(marker.requestRecordSha256, "marker request hash")) {
      fail("The Request freeze request.json hash does not match its recovery marker.");
    }
    const record = requestFile.value;
    try {
      this.#assertRequestRecord(record, loadedWithWorkingCopy, {
        requestId,
        attemptId,
      });
    } catch (cause) {
      fail(
        "The Request freeze request.json failed its identity validation.",
        { cause: cause?.code || null },
      );
    }
    if (
      record.status !== "processing"
      || record.expectedSourceSha256 !== assertSha256(marker.expectedSourceSha256, "marker source hash")
      || record.sourceWorkingCopyId !== marker.sourceWorkingCopyId
      || record.inputManifestSha256 !== assertSha256(marker.inputManifestSha256, "marker manifest hash")
    ) {
      fail("The Request freeze request.json does not match its recovery marker.");
    }
    for (const [field, expected] of Object.entries(expectedRequestPaths)) {
      if (record[field] !== expected) {
        fail("The Request freeze request path is not canonical.", {
          field,
          actual: record[field] || null,
          expected,
        });
      }
    }

    const manifestFile = await readJsonWithHash(
      path.join(root, "input-manifest.json"),
      "input-manifest.json",
    );
    if (!manifestFile) fail("The Request freeze has no input-manifest.json.");
    if (
      manifestFile.sha256 !== record.inputManifestSha256
      || manifestFile.sha256 !== marker.inputManifestSha256
    ) {
      fail("The Request freeze input manifest hash does not match its authority.");
    }
    const inputManifest = manifestFile.value;
    if (
      inputManifest.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || inputManifest.projectId !== loaded.project.projectId
      || inputManifest.documentId !== loaded.project.documentId
      || inputManifest.requestId !== requestId
      || inputManifest.attemptId !== attemptId
      || inputManifest.frozen !== true
      || !Array.isArray(inputManifest.readOrder)
      || !Array.isArray(inputManifest.files)
    ) {
      fail("The Request freeze input manifest has invalid identity or shape.");
    }
    const manifestEntries = new Map();
    for (const [index, entry] of inputManifest.files.entries()) {
      if (!isObject(entry)) fail("The Request freeze input manifest has an invalid file entry.", { index });
      let relativePath;
      try {
        relativePath = ensureRelativePath(entry.path, `input-manifest.files[${index}].path`);
        assertSha256(entry.sha256, `input-manifest.files[${index}].sha256`);
      } catch (cause) {
        fail("The Request freeze input manifest has an unsafe file entry.", {
          index,
          cause: cause?.code || null,
        });
      }
      if (
        entry.path !== relativePath
        || manifestEntries.has(relativePath)
        || typeof entry.role !== "string"
        || !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u.test(String(entry.mediaType || ""))
        || !Number.isSafeInteger(entry.byteLength)
        || entry.byteLength < 0
      ) {
        fail("The Request freeze input manifest has a duplicate or invalid file entry.", {
          path: relativePath || entry.path || null,
        });
      }
      if (
        entry.role === "comment-attachment"
        && (
          !relativePath.startsWith("input/attachments/")
          || entry.byteLength < 1
          || entry.byteLength > MAX_REQUEST_ATTACHMENT_BYTES
        )
      ) {
        fail("The Request freeze contains an invalid comment attachment manifest entry.", {
          path: relativePath,
        });
      }
      manifestEntries.set(relativePath, entry);
    }
    const readOrder = [];
    for (const [index, value] of inputManifest.readOrder.entries()) {
      let relativePath;
      try {
        relativePath = ensureRelativePath(value, `input-manifest.readOrder[${index}]`);
      } catch (cause) {
        fail("The Request freeze input manifest has an unsafe readOrder entry.", {
          index,
          cause: cause?.code || null,
        });
      }
      if (readOrder.includes(relativePath) || !manifestEntries.has(relativePath)) {
        fail("The Request freeze input manifest readOrder is not a manifest subset.", {
          path: relativePath,
        });
      }
      readOrder.push(relativePath);
    }
    const requiredEntries = [
      ["PROMPT.md", "prompt", "text/markdown"],
      ["input/AI_RULES.md", "policy", "text/markdown"],
      ["change-request.json", "change-request", "application/json"],
      ["input/PROJECT.md", "project-rules", "text/markdown"],
      ["input/base/index.html", "base-html", "text/html"],
      ["input/annotations/records.json", "annotations", "application/json"],
    ];
    for (const [relativePath, role, mediaType] of requiredEntries) {
      const entry = manifestEntries.get(relativePath);
      if (!entry || entry.role !== role || entry.mediaType !== mediaType || !readOrder.includes(relativePath)) {
        fail("The Request freeze input manifest is missing a required file.", {
          path: relativePath,
        });
      }
    }
    if (manifestEntries.get("input/base/index.html").sha256 !== record.expectedSourceSha256) {
      fail("The Request freeze base HTML does not match the frozen source authority.");
    }
    const files = new Map();
    for (const [relativePath, entry] of manifestEntries) {
      files.set(relativePath, await readManifestFile(relativePath, entry));
    }
    const actualFiles = await this.#verifyRequestFreezeTree({
      root,
      projectRootPath: loaded.paths.projectRootPath,
    });
    const expectedFiles = new Set([
      "request.json",
      "input-manifest.json",
      ...manifestEntries.keys(),
    ]);
    if (
      actualFiles.size !== expectedFiles.size
      || [...expectedFiles].some((relativePath) => !actualFiles.has(relativePath))
    ) {
      fail("The Request freeze contains files outside its verified bundle.", {
        unexpected: [...actualFiles].filter((relativePath) => !expectedFiles.has(relativePath)),
        missing: [...expectedFiles].filter((relativePath) => !actualFiles.has(relativePath)),
      });
    }

    const requestComments = Array.isArray(record.request?.comments)
      ? record.request.comments
      : [];
    const requestAttachments = Array.isArray(record.request?.taskSpec?.attachments)
      ? record.request.taskSpec.attachments
      : Array.isArray(record.request?.attachments)
        ? record.request.attachments
        : [];
    const attachmentEntries = new Map(
      [...manifestEntries.entries()]
        .filter(([, entry]) => entry.role === "comment-attachment")
        .map(([relativePath, entry]) => [relativePath, entry]),
    );
    const requestAttachmentsById = new Map();
    for (const attachment of requestAttachments) {
      if (!isObject(attachment)) fail("The Request freeze has an invalid attachment reference.");
      const attachmentId = String(attachment.attachmentId || "");
      let requestRelativePath;
      let relativePath;
      try {
        requestRelativePath = ensureRelativePath(
          attachment.requestRelativePath,
          `attachment ${attachmentId} requestRelativePath`,
        );
        relativePath = ensureRelativePath(
          attachment.relativePath,
          `attachment ${attachmentId} relativePath`,
        );
        assertSha256(attachment.sha256, `attachment ${attachmentId} sha256`);
      } catch (cause) {
        fail("The Request freeze has an unsafe attachment reference.", {
          attachmentId,
          cause: cause?.code || null,
        });
      }
      if (
        !attachmentId
        || requestAttachmentsById.has(attachmentId)
        || relativePath !== `requests/${requestId}/${requestRelativePath}`
        || !attachmentEntries.has(requestRelativePath)
      ) {
        fail("The Request freeze attachment reference is not canonical.", { attachmentId });
      }
      const entry = attachmentEntries.get(requestRelativePath);
      if (
        entry.mediaType !== attachment.mediaType
        || entry.byteLength !== attachment.byteLength
        || entry.sha256 !== attachment.sha256
        || attachment.commentId === undefined
      ) {
        fail("The Request freeze attachment metadata does not match its manifest.", {
          attachmentId,
        });
      }
      requestAttachmentsById.set(attachmentId, attachment);
    }
    if (requestAttachmentsById.size !== attachmentEntries.size) {
      fail("The Request freeze manifest contains an unreferenced comment attachment.");
    }
    for (const comment of requestComments) {
      for (const attachment of Array.isArray(comment?.attachments) ? comment.attachments : []) {
        const frozen = requestAttachmentsById.get(String(attachment?.attachmentId || ""));
        if (
          !frozen
          || attachment.requestRelativePath !== frozen.requestRelativePath
        ) {
          fail("The Request freeze comment attachment reference is inconsistent.");
        }
      }
    }
    let annotations;
    try {
      annotations = JSON.parse(files.get("input/annotations/records.json").buffer.toString("utf8"));
    } catch {
      fail("The Request freeze annotations file is not valid JSON.");
    }
    if (
      !isObject(annotations)
      || annotations.projectId !== loaded.project.projectId
      || annotations.documentId !== loaded.project.documentId
      || annotations.requestId !== requestId
      || annotations.attemptId !== attemptId
      || JSON.stringify(annotations.comments || []) !== JSON.stringify(requestComments)
    ) {
      fail("The Request freeze annotations do not match frozen comment requirements.");
    }
    if (record.request?.taskSpec !== undefined) {
      try {
        assertTaskSpec(record.request.taskSpec);
      } catch (cause) {
        fail("The Request freeze Task Spec is invalid.", {
          cause: cause?.code || null,
        });
      }
    }
    return { record, workingCopy, inputManifest };
  }

  async #recoverRequestFreezeForId(loaded, requestId) {
    const id = String(requestId || "");
    const stagingRoot = requestFreezeStagingRootPath(loaded.paths, id);
    const markerPath = requestFreezeMarkerPath(loaded.paths, id);
    const requestRoot = requestRootPath(loaded.paths, id);
    const staging = await directoryInformation(
      stagingRoot,
      "Request freeze staging directory",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    const markerInformation = await regularInformation(
      markerPath,
      "Request freeze recovery marker",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    const published = await directoryInformation(
      requestRoot,
      "Request directory",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (!staging && !markerInformation) return null;
    if (!markerInformation) {
      await this.#cleanupRequestFreezeForId(loaded, id);
      return {
        kind: "request-freeze",
        requestId: id,
        state: "discarded-unpublished-staging",
      };
    }
    if (!staging && !published) {
      throw requestFreezeRecoveryError(
        "The Request freeze recovery marker has no staging or published bundle.",
        { requestId: id },
      );
    }
    if (staging && published) {
      throw new ProjectFileRepositoryError(
        "REQUEST_FREEZE_COLLISION",
        "The Request freeze has both staging and published directories; recovery will not choose between them.",
        { requestId: id },
      );
    }
    const marker = await readJsonFile(
      markerPath,
      "Request freeze recovery marker",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    this.#assertRequestFreezeMarker(marker, loaded, id);
    const verified = await this.#verifyRequestFreezeBundle({
      loaded,
      root: staging ? stagingRoot : requestRoot,
      marker,
    });
    if (staging) {
      await rename(stagingRoot, requestRoot);
      await syncDirectory(loaded.paths.requestsRoot);
    }
    await this.#restoreRequestRuntime(
      { ...loaded, workingCopy: verified.workingCopy },
      verified.record,
    );
    await unlink(markerPath);
    await syncDirectory(path.dirname(markerPath)).catch(() => {});
    return {
      kind: "request-freeze",
      requestId: id,
      attemptId: verified.record.attemptId,
      state: "recovered",
    };
  }

  async #recoverRequestFreezes(loaded) {
    const root = path.join(loaded.paths.recoveryRoot, "request-freeze");
    const information = await directoryInformation(
      root,
      "Request freeze recovery directory",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (!information) return [];
    const entries = await readdir(root, { withFileTypes: true });
    const requestIds = new Set();
    for (const entry of entries) {
      if (entry.isSymbolicLink()) {
        throw requestFreezeRecoveryError(
          "The Request freeze recovery directory contains a symbolic link.",
          { path: entry.name },
        );
      }
      if (entry.isDirectory()) {
        if (!SAFE_REQUEST_ID.test(entry.name)) {
          throw requestFreezeRecoveryError(
            "The Request freeze staging directory has an invalid Request id.",
            { path: entry.name },
          );
        }
        requestIds.add(entry.name);
        continue;
      }
      if (
        !entry.isFile()
        || !entry.name.endsWith(".json")
        || !SAFE_REQUEST_ID.test(entry.name.slice(0, -5))
      ) {
        throw requestFreezeRecoveryError(
          "The Request freeze recovery directory contains an unexpected entry.",
          { path: entry.name },
        );
      }
      requestIds.add(entry.name.slice(0, -5));
    }
    const recovered = [];
    for (const requestId of [...requestIds].sort()) {
      const result = await this.#recoverRequestFreezeForId(loaded, requestId);
      if (result) recovered.push(result);
    }
    return recovered;
  }

  #assertRequestRecord(record, loaded, { requestId, attemptId }) {
    if (
      !isObject(record)
      || record.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || record.requestId !== requestId
      || record.attemptId !== attemptId
      || record.projectId !== loaded.project.projectId
      || record.documentId !== loaded.project.documentId
      || record.sourceWorkingCopyId !== loaded.workingCopy.workingCopyId
    ) {
      throw new ProjectFileRepositoryError(
        "REQUEST_IDENTITY_MISMATCH",
        "The frozen Request does not belong to this active Working Copy.",
      );
    }
    assertCandidateId(record.candidateId);
    try {
      normalizeAgentDelivery(record.request?.agentDelivery || { mode: "clipboard" });
    } catch (cause) {
      throw new ProjectFileRepositoryError(
        "AGENT_DELIVERY_INVALID",
        "The frozen Request Agent delivery policy is invalid.",
        { reasonCode: cause?.code || "AGENT_DELIVERY_INVALID" },
      );
    }
    if (record.request?.taskSpec !== undefined) {
      if (
        !SUPPORTED_FROZEN_REQUEST_POLICY_VERSIONS.has(record.policyVersion)
        || !SUPPORTED_FROZEN_REQUEST_PROMPT_TEMPLATE_VERSIONS.has(
          record.promptTemplateVersion,
        )
      ) {
        throw new ProjectFileRepositoryError(
          "REQUEST_TEMPLATE_VERSION_INVALID",
          "The frozen Request policy or Prompt template version is unsupported.",
        );
      }
      try {
        assertTaskSpec(record.request.taskSpec);
      } catch (cause) {
        throw new ProjectFileRepositoryError(
          "TASK_SPEC_INVALID",
          "The frozen Request Task Spec is invalid.",
          { reasonCode: cause?.code || "TASK_SPEC_INVALID" },
        );
      }
    }
    assertSha256(record.expectedSourceSha256, "request expectedSourceSha256");
    assertId(record.proposedVersionId, VERSION_ID, "proposedVersionId");
    if (!Number.isSafeInteger(record.proposedVersionOrdinal) || record.proposedVersionOrdinal < 2) {
      throw new ProjectFileRepositoryError("INVALID_REQUEST", "The Request Version ordinal is invalid.");
    }
    assertId(record.basedOnVersionId, VERSION_ID, "basedOnVersionId");
    assertId(record.previousVersionId, VERSION_ID, "previousVersionId");
    ensureRelativePath(record.inputRelativePath, "request input path");
    ensureRelativePath(record.outputRelativePath, "request output path");
    for (const [value, label] of [
      [record.promptRelativePath, "request prompt path"],
      [record.projectRulesRelativePath, "request project rules path"],
      [record.annotationsRelativePath, "request annotations path"],
      [record.changeRequestRelativePath, "request change record path"],
      [record.inputManifestRelativePath, "request input manifest path"],
    ]) {
      if (value !== undefined) ensureRelativePath(value, label);
    }
    assertSha256(record.inputManifestSha256, "request input manifest hash");
  }

  async #frozenPromptForAiTaskProjection(loaded, record) {
    const inputManifestPath = resolveRelative(
      loaded.paths.controlRoot,
      record.inputManifestRelativePath,
      "request input manifest path",
    );
    const inputManifestRecord = await readJsonFileWithSha256(
      inputManifestPath,
      "request input manifest",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    const inputManifest = inputManifestRecord?.value || null;
    if (
      !inputManifestRecord
      || inputManifestRecord.sha256 !== record.inputManifestSha256
      || !isObject(inputManifest)
      || inputManifest.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || inputManifest.projectId !== loaded.project.projectId
      || inputManifest.documentId !== loaded.project.documentId
      || inputManifest.requestId !== record.requestId
      || inputManifest.attemptId !== record.attemptId
      || inputManifest.frozen !== true
      || !Array.isArray(inputManifest.files)
    ) {
      throw new ProjectFileRepositoryError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request bundle cannot safely provide an AI task Prompt.",
      );
    }
    const promptEntry = inputManifest.files.find((entry) => (
      isObject(entry)
      && entry.path === "PROMPT.md"
      && entry.role === "prompt"
      && entry.mediaType === "text/markdown"
    ));
    if (
      !promptEntry
      || !SHA256.test(String(promptEntry.sha256 || ""))
      || !Number.isSafeInteger(Number(promptEntry.byteLength))
      || Number(promptEntry.byteLength) < 0
    ) {
      throw new ProjectFileRepositoryError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request bundle has no valid Prompt record.",
      );
    }
    const promptPath = resolveRelative(
      loaded.paths.controlRoot,
      record.promptRelativePath,
      "request prompt path",
    );
    const prompt = await readRegularFileWithSha256(
      promptPath,
      "Request prompt",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (
      !prompt
      || prompt.sha256 !== promptEntry.sha256
      || prompt.buffer.byteLength !== Number(promptEntry.byteLength)
    ) {
      throw new ProjectFileRepositoryError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request Prompt no longer matches its manifest.",
      );
    }
    return {
      path: promptPath,
      buffer: prompt.buffer,
      sha256: prompt.sha256,
    };
  }

  // AI任务/ is a derived Finder display. Once a Request or Candidate has
  // crossed its durable authority boundary, a publication failure must not
  // retract that hidden fact. Explicit Finder requests remain strict through
  // #materializeAiTaskProjection and can be retried independently.
  async #publishAiTaskProjectionIfPossible(args) {
    try {
      return await this.#materializeAiTaskProjection(args);
    } catch {
      return null;
    }
  }

  async #terminalAiTaskForLoaded(loaded) {
    const terminal = loaded.runtime.lastAiTask;
    if (!terminal) return null;
    const workingCopy = loaded.manifest.workingCopies.find(
      (entry) => entry.workingCopyId === terminal.sourceWorkingCopyId,
    );
    if (!workingCopy) {
      throw new ProjectFileRepositoryError(
        "REQUEST_RUNTIME_ANCHOR_MISMATCH",
        "The terminal AI task no longer names a managed Working Copy.",
      );
    }
    const requestPath = path.join(
      requestRootPath(loaded.paths, terminal.requestId),
      "request.json",
    );
    const record = await readJsonFile(requestPath, "request.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    this.#assertRequestRecord(record, { ...loaded, workingCopy }, {
      requestId: terminal.requestId,
      attemptId: terminal.attemptId,
    });
    if (
      terminal.projectId !== record.projectId
      || terminal.documentId !== record.documentId
      || terminal.candidateId !== record.candidateId
      || terminal.sourceWorkingCopyId !== record.sourceWorkingCopyId
      || terminal.expectedSourceSha256 !== record.expectedSourceSha256
      || terminal.inputManifestSha256 !== record.inputManifestSha256
      || terminal.status !== record.status
      || terminal.completedAt !== record.completedAt
    ) {
      throw new ProjectFileRepositoryError(
        "REQUEST_RUNTIME_ANCHOR_MISMATCH",
        "The terminal AI task no longer matches its sealed runtime anchor.",
      );
    }
    return { record, workingCopy };
  }

  async #materializeCurrentAiTaskProjection({ target }) {
    const loaded = await this.#resolveMutationTarget(target);
    const active = loaded.runtime.activeRequest;
    if (!active && !loaded.runtime.lastAiTask) {
      throw new ProjectFileRepositoryError(
        "AI_TASK_NOT_ACTIVE",
        "The current project has no active or terminal AI task to reveal.",
      );
    }
    let record;
    let materializationTarget = target;
    if (active) {
      const requestPath = path.join(
        requestRootPath(loaded.paths, active.requestId),
        "request.json",
      );
      record = await readJsonFile(requestPath, "request.json", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      this.#assertRequestRecord(record, loaded, {
        requestId: active.requestId,
        attemptId: active.attemptId,
      });
      if (
        active.inputManifestSha256 !== record.inputManifestSha256
        || (
          active.status === "pending-review"
          && active.candidateId !== record.candidateId
        )
      ) {
        throw new ProjectFileRepositoryError(
          "REQUEST_RUNTIME_ANCHOR_MISMATCH",
          "The active Request no longer matches its runtime authority.",
        );
      }
    } else {
      const terminal = await this.#terminalAiTaskForLoaded(loaded);
      record = terminal.record;
      materializationTarget = {
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        projectRootPath: loaded.paths.projectRootPath,
        workingCopyId: terminal.workingCopy.workingCopyId,
      };
    }
    return this.#materializeAiTaskProjection({
      target: materializationTarget,
      requestId: record.requestId,
      attemptId: record.attemptId,
      candidateId: record.candidateId,
    });
  }

  async #materializeAiTaskProjection({
    target,
    requestId,
    attemptId,
    candidateId,
  }) {
    const loaded = await this.#resolveMutationTarget(target);
    const request = String(requestId || "");
    const attempt = String(attemptId || "attempt_001");
    if (!SAFE_REQUEST_ID.test(request) || !SAFE_REQUEST_ID.test(attempt)) {
      throw new ProjectFileRepositoryError(
        "INVALID_REQUEST_ID",
        "The AI task projection Request identity is invalid.",
      );
    }
    const requestPath = path.join(requestRootPath(loaded.paths, request), "request.json");
    const record = await readJsonFile(requestPath, "request.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    this.#assertRequestRecord(record, loaded, { requestId: request, attemptId: attempt });
    const expectedCandidateId = assertCandidateId(record.candidateId);
    if (candidateId !== null && candidateId !== undefined) {
      const requestedCandidateId = assertCandidateId(candidateId);
      if (requestedCandidateId !== expectedCandidateId) {
        throw new ProjectFileRepositoryError(
          "CANDIDATE_IDENTITY_MISMATCH",
          "The requested AI task Candidate does not belong to this Request.",
        );
      }
    }
    const frozenPrompt = await this.#frozenPromptForAiTaskProjection(loaded, record);
    let candidateState = null;
    if (["candidate-ready", "promoted", "rejected"].includes(record.status)) {
      candidateState = await this.#readCandidateForLoaded(loaded, expectedCandidateId);
      const candidate = candidateState.candidate;
      if (
        candidate.candidateId !== expectedCandidateId
        || candidate.projectId !== loaded.project.projectId
        || candidate.documentId !== loaded.project.documentId
        || candidate.requestId !== record.requestId
        || candidate.attemptId !== record.attemptId
        || candidate.proposedVersionId !== record.proposedVersionId
        || Number(candidate.proposedVersionOrdinal) !== Number(record.proposedVersionOrdinal)
        || candidate.basedOnVersionId !== record.basedOnVersionId
        || candidate.previousVersionId !== record.previousVersionId
      ) {
        throw new ProjectFileRepositoryError(
          "CANDIDATE_AUTHORITY_MISMATCH",
          "The Candidate does not match the frozen AI task identity.",
        );
      }
    }
    const candidateFileName = aiTaskCandidateFileName(
      loaded.workingCopy.preferredFileStem,
      record.proposedVersionOrdinal,
      loaded.workingCopy.preferredExtension,
    );
    try {
      const projection = await materializeAiTaskProjection({
        projectRootPath: loaded.paths.projectRootPath,
        recoveryRootPath: path.join(
          loaded.paths.recoveryRoot,
          "ai-task-projections",
        ),
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        requestId: record.requestId,
        attemptId: record.attemptId,
        candidateId: expectedCandidateId,
        proposedVersionId: record.proposedVersionId,
        proposedVersionOrdinal: record.proposedVersionOrdinal,
        createdAt: record.createdAt,
        promptBuffer: frozenPrompt.buffer,
        promptSha256: frozenPrompt.sha256,
        candidateBuffer: candidateState?.output.buffer || null,
        candidateSha256: candidateState?.output.sha256 || null,
        candidateFileName,
        onStage: (name, details) => this.#hit(name, {
          requestId: record.requestId,
          attemptId: record.attemptId,
          candidateId: expectedCandidateId,
          ...details,
        }),
      });
      return {
        ...projection,
        status: record.status,
        hasCandidate: candidateState !== null,
      };
    } catch (cause) {
      if (cause instanceof AiTaskProjectionError) {
        throw new ProjectFileRepositoryError(cause.code, cause.message, cause.details);
      }
      throw cause;
    }
  }

  #assertCompletionRecord(completion, request) {
    if (
      !isObject(completion)
      || completion.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || completion.kind !== "candidate-finalization"
      || completion.projectId !== request.projectId
      || completion.documentId !== request.documentId
      || completion.requestId !== request.requestId
      || completion.attemptId !== request.attemptId
      || completion.candidateId !== request.candidateId
      || completion.proposedVersionId !== request.proposedVersionId
      || Number(completion.proposedVersionOrdinal) !== Number(request.proposedVersionOrdinal)
      || completion.basedOnVersionId !== request.basedOnVersionId
      || completion.previousVersionId !== request.previousVersionId
      || completion.expectedSourceSha256 !== request.expectedSourceSha256
      || completion.inputManifestSha256 !== request.inputManifestSha256
      || completion.outputRelativePath !== request.outputRelativePath
      || !SHA256.test(String(completion.outputSha256 || ""))
      || !["completed", "no-change"].includes(completion.status)
      || !completion.completedAt
      || Number.isNaN(Date.parse(completion.completedAt))
    ) {
      throw new ProjectFileRepositoryError(
        "COMPLETION_IDENTITY_MISMATCH",
        "completion.json does not belong to this immutable Request.",
      );
    }
  }

  #publicRequest(record, projectRootPath) {
    const publicRequirements = structuredClone(record.request || {});
    publicRequirements.agentDelivery = normalizeAgentDelivery(
      publicRequirements.agentDelivery || { mode: "clipboard" },
    );
    return {
      requestId: record.requestId,
      attemptId: record.attemptId,
      candidateId: record.candidateId,
      projectId: record.projectId,
      documentId: record.documentId,
      sourceWorkingCopyId: record.sourceWorkingCopyId,
      expectedSourceSha256: record.expectedSourceSha256,
      proposedVersionId: record.proposedVersionId,
      proposedVersionOrdinal: record.proposedVersionOrdinal,
      basedOnVersionId: record.basedOnVersionId,
      previousVersionId: record.previousVersionId,
      status: record.status,
      createdAt: record.createdAt,
      request: publicRequirements,
      projectRootPath,
      requestRelativePath: `requests/${record.requestId}`,
      ...(record.promptRelativePath ? { promptRelativePath: record.promptRelativePath } : {}),
      ...(record.projectRulesRelativePath
        ? { projectRulesRelativePath: record.projectRulesRelativePath }
        : {}),
      ...(record.annotationsRelativePath
        ? { annotationsRelativePath: record.annotationsRelativePath }
        : {}),
      ...(record.changeRequestRelativePath
        ? { changeRequestRelativePath: record.changeRequestRelativePath }
        : {}),
      ...(record.inputManifestRelativePath
        ? { inputManifestRelativePath: record.inputManifestRelativePath }
        : {}),
      ...(record.inputManifestSha256
        ? { inputManifestSha256: record.inputManifestSha256 }
        : {}),
      outputRelativePath: record.outputRelativePath,
      ...(isObject(record.error) ? { error: structuredClone(record.error) } : {}),
    };
  }

  async #recordRequestValidationError({ loaded, record, cause, previewHtml = "" }) {
    const mapped = mapCandidateValidationError(cause) || {
      errorCode: String(cause?.code || "CANDIDATE_UNUSABLE"),
      message: String(cause?.message || "The Candidate HTML is unusable."),
      errorDetail: "输出未通过安全校验",
      recoveryHint: "请检查 AI Agent 的输出后重新提交。",
    };
    const requestPath = path.join(
      requestRootPath(loaded.paths, record.requestId),
      "request.json",
    );
    record.status = "error";
    record.completedAt = nowIso(this.#clock);
    record.error = {
      code: String(cause?.code || mapped.errorCode),
      message: mapped.message,
      errorCode: mapped.errorCode,
      errorDetail: mapped.errorDetail,
      recoveryHint: mapped.recoveryHint,
      issueCodes: Array.isArray(cause?.details?.issueCodes)
        ? cause.details.issueCodes
        : [],
    };
    await this.#writeRequestWithHistory(loaded, requestPath, record);
    loaded.runtime.activeRequest = null;
    loaded.runtime.activeCandidateId = null;
    loaded.runtime.lastAiTask = lastAiTaskAnchorFor(record);
    await this.#writeRuntime(loaded);
    const publicRequest = this.#publicRequest(record, loaded.paths.projectRootPath);
    const preview = previewSnippet(previewHtml);
    if (preview && isObject(publicRequest.error)) {
      publicRequest.error = {
        ...publicRequest.error,
        errorPreview: preview,
      };
    }
    return {
      status: "error",
      request: publicRequest,
    };
  }

  async #restoreRequestRuntime(loaded, record) {
    this.#assertRequestRecord(record, loaded, {
      requestId: record.requestId,
      attemptId: record.attemptId,
    });
    const existingActiveRequest = loaded.runtime.activeRequest;
    if (
      existingActiveRequest
      && (
        existingActiveRequest.requestId !== record.requestId
        || existingActiveRequest.attemptId !== record.attemptId
      )
    ) {
      throw new ProjectFileRepositoryError(
        "REQUEST_RUNTIME_ANCHOR_MISMATCH",
        "The frozen Request identity no longer matches runtime authority.",
      );
    }
    if (
      existingActiveRequest
      && existingActiveRequest.inputManifestSha256 !== record.inputManifestSha256
    ) {
      throw new ProjectFileRepositoryError(
        "FROZEN_REQUEST_BUNDLE_MISMATCH",
        "The frozen Request input manifest no longer matches runtime authority.",
      );
    }
    let status = record.status;
    let candidateId = null;
    if (status === "processing") {
      const candidatePath = path.join(
        requestRootPath(loaded.paths, record.requestId),
        "candidate.json",
      );
      const candidateRecord = await readJsonFileWithSha256(candidatePath, "candidate.json", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      const candidate = candidateRecord?.value || null;
      if (candidate) {
        const outputPath = resolveRelative(
          loaded.paths.controlRoot,
          candidate.outputRelativePath,
          "candidate output path",
        );
        const output = await readHtmlFile(outputPath, "Candidate HTML", {
          projectRootPath: loaded.paths.projectRootPath,
        });
        if (
          candidate.candidateId !== record.candidateId
          || candidate.status !== "pending-review"
          || existingActiveRequest?.requestId !== record.requestId
          || existingActiveRequest?.attemptId !== record.attemptId
          || existingActiveRequest.status !== "pending-review"
          || existingActiveRequest.candidateId !== record.candidateId
          || existingActiveRequest.candidateOutputSha256 !== output.sha256
          || existingActiveRequest.candidateRecordSha256 !== candidateRecord.sha256
        ) {
          throw new ProjectFileRepositoryError(
            "CANDIDATE_AUTHORITY_MISMATCH",
            "A Candidate exists without the runtime authority required for review.",
          );
        }
        record.status = "candidate-ready";
        record.completedAt = record.completedAt || nowIso(this.#clock);
        await this.#writeRequestWithHistory(loaded, path.join(requestRootPath(loaded.paths, record.requestId), "request.json"), record);
        status = record.status;
      }
    }
    let candidateOutputSha256 = null;
    let candidateRecordSha256 = null;
    if (status === "candidate-ready") {
      candidateId = record.candidateId;
      const candidateState = await this.#readCandidateForLoaded(loaded, candidateId);
      candidateOutputSha256 = candidateState.output.sha256;
      candidateRecordSha256 = candidateState.candidateRecordSha256;
      if (
        existingActiveRequest?.requestId !== record.requestId
        || existingActiveRequest?.attemptId !== record.attemptId
        || existingActiveRequest.status !== "pending-review"
        || existingActiveRequest.candidateId !== candidateId
        || existingActiveRequest.candidateOutputSha256 !== candidateOutputSha256
        || existingActiveRequest.candidateRecordSha256 !== candidateRecordSha256
      ) {
        throw new ProjectFileRepositoryError(
          "CANDIDATE_AUTHORITY_MISMATCH",
          "A Candidate-ready Request is missing its sealed runtime authority.",
        );
      }
    } else if (status !== "processing") {
      if (loaded.runtime.activeRequest?.requestId === record.requestId) {
        loaded.runtime.activeRequest = null;
        loaded.runtime.activeCandidateId = null;
        if (
          ["no-change", "error"].includes(status)
          && validStateTimestamp(record.completedAt)
        ) {
          loaded.runtime.lastAiTask = lastAiTaskAnchorFor(record);
        }
        await this.#writeRuntime(loaded);
      }
      return false;
    }
    const nextActiveRequest = {
      requestId: record.requestId,
      candidateId,
      attemptId: record.attemptId,
      status: candidateId ? "pending-review" : "processing",
      inputManifestSha256: record.inputManifestSha256,
      candidateOutputSha256,
      candidateRecordSha256,
    };
    const active = loaded.runtime.activeRequest;
    if (
      active?.requestId !== nextActiveRequest.requestId
      || active?.attemptId !== nextActiveRequest.attemptId
      || active?.candidateId !== nextActiveRequest.candidateId
      || active?.status !== nextActiveRequest.status
      || active?.inputManifestSha256 !== nextActiveRequest.inputManifestSha256
      || active?.candidateOutputSha256 !== nextActiveRequest.candidateOutputSha256
      || active?.candidateRecordSha256 !== nextActiveRequest.candidateRecordSha256
      || loaded.runtime.activeCandidateId !== candidateId
    ) {
      loaded.runtime.activeRequest = nextActiveRequest;
      loaded.runtime.activeCandidateId = candidateId;
      loaded.runtime.lastAiTask = null;
      await this.#writeRuntime(loaded);
      return true;
    }
    return false;
  }

  async #requestStatus({ target, requestId, attemptId }) {
    const loaded = await this.#resolveMutationTarget(target);
    const requestRoot = requestRootPath(loaded.paths, requestId);
    const record = await readJsonFile(path.join(requestRoot, "request.json"), "request.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    this.#assertRequestRecord(record, loaded, { requestId, attemptId });
    if (record.status === "candidate-ready" || record.status === "promoted") {
      const candidate = await this.#readCandidateForLoaded(loaded, record.candidateId);
      return {
        status: record.status === "promoted" ? "promoted" : "candidate-ready",
        request: this.#publicRequest(record, loaded.paths.projectRootPath),
        candidate: structuredClone(candidate.candidate),
      };
    }
    if (["no-change", "rejected", "cancelled", "error"].includes(record.status)) {
      return {
        status: record.status,
        request: this.#publicRequest(record, loaded.paths.projectRootPath),
      };
    }
    if (record.status !== "processing") {
      throw new ProjectFileRepositoryError(
        "INVALID_REQUEST_STATUS",
        "The Request has an unsupported lifecycle state.",
      );
    }
    const completionPath = path.join(requestRoot, "attempts", attemptId, "completion.json");
    const completion = await readJsonFile(completionPath, "completion.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (!completion) {
      return {
        status: "processing",
        request: this.#publicRequest(record, loaded.paths.projectRootPath),
      };
    }
    this.#assertCompletionRecord(completion, record);
    const outputPath = resolveRelative(
      loaded.paths.controlRoot,
      completion.outputRelativePath,
      "completion output path",
    );
    const output = await readHtmlFile(outputPath, "finalized Candidate output", {
      projectRootPath: loaded.paths.projectRootPath,
    }).catch(async (cause) => {
      if (String(cause?.code || "") !== "INCOMPLETE_HTML") throw cause;
      let previewHtml = "";
      try {
        previewHtml = await readFile(outputPath, "utf8");
      } catch {
        previewHtml = "";
      }
      return { incomplete: true, cause, previewHtml };
    });
    if (output?.incomplete) {
      return this.#recordRequestValidationError({
        loaded,
        record,
        cause: output.cause,
        previewHtml: output.previewHtml,
      });
    }
    if (output.sha256 !== completion.outputSha256) {
      throw new ProjectFileRepositoryError(
        "REQUEST_OUTPUT_CHANGED",
        "The finalized Candidate output changed after finalization.",
      );
    }
    return this.#completeRequest({
      target,
      requestId,
      attemptId,
      html: output.html,
    });
  }

  async #cancelRequest({ target, requestId, attemptId, discardCandidate = false }) {
    const loaded = await this.#resolveMutationTarget(target);
    const requestRoot = requestRootPath(loaded.paths, requestId);
    const requestPath = path.join(requestRoot, "request.json");
    const record = await readJsonFile(requestPath, "request.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    this.#assertRequestRecord(record, loaded, { requestId, attemptId });
    if (record.status === "candidate-ready") {
      if (!discardCandidate) return { requestId, attemptId, status: "result-ready", candidateId: record.candidateId };
      const rejected = await this.#rejectCandidate({ target, candidateId: record.candidateId });
      return {
        ...rejected,
        requestId,
        attemptId,
        status: "cancelled",
      };
    }
    if (["rejected", "no-change", "promoted", "error"].includes(record.status)) {
      return {
        requestId,
        attemptId,
        status: "already-inactive",
        terminalStatus: record.status,
      };
    }
    if (!["processing", "cancelled"].includes(record.status)) {
      throw new ProjectFileRepositoryError(
        "INVALID_REQUEST_STATUS",
        "The Request has an unsupported lifecycle state.",
      );
    }
    const authorityPath = cancellationAuthorityPath(loaded.paths, requestId, attemptId);
    const authority = await readJsonFile(authorityPath, "request cancellation authority", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    const validAuthority = authority
      && authority.schemaVersion === PROJECT_FILE_SCHEMA_VERSION
      && authority.kind === "request-cancellation"
      && authority.projectId === loaded.project.projectId
      && authority.documentId === loaded.project.documentId
      && authority.requestId === requestId
      && authority.attemptId === attemptId
      && authority.sourceWorkingCopyId === loaded.workingCopy.workingCopyId
      && authority.expectedSourceSha256 === record.expectedSourceSha256
      && authority.inputManifestSha256 === record.inputManifestSha256
      && validStateTimestamp(authority.cancelledAt);
    const active = loaded.runtime.activeRequest;
    const activeMatches = active
      && active.requestId === requestId
      && active.attemptId === attemptId
      && active.inputManifestSha256 === record.inputManifestSha256;
    if (record.status === "cancelled" && !activeMatches) {
      if (!validAuthority) {
        throw new ProjectFileRepositoryError(
          "CANCELLATION_AUTHORITY_MISMATCH",
          "The Request cancellation is not sealed outside the Agent-writable Request tree.",
        );
      }
      return { requestId, attemptId, status: "already-inactive", terminalStatus: "cancelled" };
    }
    if (!activeMatches) {
      throw new ProjectFileRepositoryError(
        "REQUEST_RUNTIME_ANCHOR_MISMATCH",
        "The active Request runtime does not authorize this cancellation.",
      );
    }
    if (!validAuthority) {
      await ensureProjectDirectory(
        loaded.paths.projectRootPath,
        path.dirname(authorityPath),
        "request cancellation authority directory",
      );
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        authorityPath,
        {
          schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
          kind: "request-cancellation",
          projectId: loaded.project.projectId,
          documentId: loaded.project.documentId,
          requestId,
          attemptId,
          sourceWorkingCopyId: loaded.workingCopy.workingCopyId,
          expectedSourceSha256: record.expectedSourceSha256,
          inputManifestSha256: record.inputManifestSha256,
          cancelledAt: nowIso(this.#clock),
        },
        "request cancellation authority",
      );
    }
    record.status = "cancelled";
    record.cancelledAt = nowIso(this.#clock);
    await this.#writeRequestWithHistory(loaded, requestPath, record);
    if (activeMatches) {
      loaded.runtime.activeRequest = null;
      loaded.runtime.activeCandidateId = null;
      await this.#writeRuntime(loaded);
    }
    return { requestId, attemptId, status: "cancelled" };
  }

  async #saveDraft({
    target,
    operationId,
    expectedDraftRevision,
    basedOnVersionId,
    comments,
    changeEvents,
    deletedCommentIds,
  }) {
    const loaded = await this.#resolveMutationTarget(target);
    if (
      basedOnVersionId
      && String(basedOnVersionId) !== loaded.workingCopy.basedOnVersionId
    ) {
      throw new ProjectFileRepositoryError(
        "DRAFT_BASE_VERSION_MISMATCH",
        "The draft does not belong to the active Working Copy base Version.",
      );
    }
    const statePath = workingCopyStatePath(loaded.paths, loaded.workingCopy);
    const state = await readJsonFile(statePath, "Working Copy state", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    assertWorkingCopyState(state, loaded, loaded.workingCopy);
    const draftPath = draftPathForState(loaded.paths, loaded.workingCopy, state);
    const persisted = await readJsonFile(draftPath, "Working Copy draft", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    let command;
    try {
      command = applyDraftCommand(
        persisted || {
          draftRevision: Number(state.draftRevision || 0),
          comments: [],
          changeEvents: [],
          deletedCommentIds: [],
          appliedOperationIds: [],
        },
        {
          operationId,
          expectedDraftRevision,
          comments,
          changeEvents,
          deletedCommentIds,
        },
        {
          randomUUID,
          now: () => nowIso(this.#clock),
          provenance: this.#localProvenance(),
        },
      );
    } catch (cause) {
      throw new ProjectFileRepositoryError(
        String(cause?.code || "INVALID_DRAFT"),
        cause instanceof Error ? cause.message : "The draft could not be saved.",
        cause?.details || {},
      );
    }
    const activeDraft = activeDraftSnapshot(command.next, () => nowIso(this.#clock));
    if (!command.replayed) {
      const stored = {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        workingCopyId: loaded.workingCopy.workingCopyId,
        basedOnVersionId: loaded.workingCopy.basedOnVersionId,
        ...activeDraft,
      };
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        draftPath,
        stored,
        "Working Copy draft",
      );
      const draftText = jsonText(stored);
      await atomicWriteProjectJson(loaded.paths.projectRootPath, statePath, {
        ...state,
        draftRelativePath: draftRelativePathFor(loaded.workingCopy),
        draftSha256: sha256(Buffer.from(draftText, "utf8")),
        draftRevision: activeDraft.draftRevision,
      }, "Working Copy state");
      await this.#hit("draft-saved", {
        workingCopyId: loaded.workingCopy.workingCopyId,
        operationId: command.operationId,
      });
    }
    return {
      replayed: command.replayed,
      operationId: command.operationId,
      activeDraft,
    };
  }

  async #readVersionFile({ target, requestedVersionId }) {
    const loaded = await this.#resolveMutationTarget(target);
    const id = assertId(requestedVersionId, VERSION_ID, "versionId");
    const version = loaded.manifest.versions.find((entry) => entry.versionId === id);
    if (version) {
      const snapshotPath = versionSnapshotPath(loaded.paths, version);
      const snapshot = await readHtmlFile(snapshotPath, "Version snapshot", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      if (snapshot.sha256 !== version.contentSha256) {
        throw new ProjectFileRepositoryError(
          "VERSION_HASH_MISMATCH",
          "The immutable Version snapshot does not match manifest.json.",
        );
      }
      return {
        kind: "version",
        version: structuredClone(version),
        content: snapshot.html,
        sha256: snapshot.sha256,
        path: snapshotPath,
      };
    }
    const candidate = await this.#readCandidateForLoaded(loaded, loaded.runtime.activeCandidateId);
    if (
      candidate.candidate.proposedVersionId !== id
      || candidate.candidate.status !== "pending-review"
    ) {
      throw new ProjectFileRepositoryError(
        "VERSION_NOT_FOUND",
        "The requested Version does not belong to this project.",
      );
    }
    return {
      kind: "candidate",
      version: {
        versionId: candidate.candidate.proposedVersionId,
        ordinal: candidate.candidate.proposedVersionOrdinal,
        basedOnVersionId: candidate.candidate.basedOnVersionId,
        previousVersionId: candidate.candidate.previousVersionId,
        contentSha256: candidate.candidate.outputSha256,
        sourceRequestId: candidate.candidate.requestId,
        sourceCandidateId: candidate.candidate.candidateId,
        createdAt: candidate.candidate.createdAt,
      },
      candidate: structuredClone(candidate.candidate),
      content: candidate.output.html,
      sha256: candidate.output.sha256,
      path: candidate.outputPath,
    };
  }

  async #resolveVersionWorkingCopy({ target, requestedVersionId }) {
    const loaded = await this.#resolveMutationTarget(target);
    const id = assertId(requestedVersionId, VERSION_ID, "versionId");
    const version = loaded.manifest.versions.find((entry) => entry.versionId === id);
    if (!version) {
      throw new ProjectFileRepositoryError(
        "VERSION_NOT_FOUND",
        "The requested Version was not found.",
      );
    }
    const matches = loaded.manifest.workingCopies.filter((workingCopy) => (
      workingCopy.versionId === id
      && workingCopy.basedOnVersionId === id
    ));
    if (matches.length !== 1) {
      throw new ProjectFileRepositoryError(
        "VERSION_WORKING_COPY_UNAVAILABLE",
        "The Version has no unambiguous visible Working Copy.",
        { versionId: id, workingCopyIds: matches.map((entry) => entry.workingCopyId) },
      );
    }
    const workingCopy = matches[0];
    // A historical Working Copy has the same controlled rename semantics as
    // the active one. Resolve it by stable file identity before reading the
    // visible path, so Finder renames do not make a valid Version reveal fail.
    const resolvedSource = await this.#resolveWorkingCopySource(
      loaded,
      workingCopy,
      "Version Working Copy",
    );
    const state = await readJsonFile(
      workingCopyStatePath(loaded.paths, workingCopy),
      "Version Working Copy state",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    assertWorkingCopyState(state, loaded, workingCopy);
    const reconciled = await this.#reconcileExternalWorkingCopyState({
      loaded,
      workingCopy,
      state,
      source: resolvedSource.source,
    });
    return {
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      projectRootPath: loaded.paths.projectRootPath,
      versionId: version.versionId,
      workingCopyId: workingCopy.workingCopyId,
      workingCopyPath: resolvedSource.exactSourcePath,
      sourceSha256: resolvedSource.source.sha256,
      workingCopyState: structuredClone(reconciled.state),
    };
  }

  async #completeRequest({ target, requestId, attemptId, html }) {
    const loaded = await this.#resolveMutationTarget(target);
    const requestRoot = requestRootPath(loaded.paths, requestId);
    const requestPath = path.join(requestRoot, "request.json");
    const record = await readJsonFile(requestPath, "request.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    this.#assertRequestRecord(record, loaded, { requestId, attemptId });
    if (record.status === "processing" && record.request?.submissionOperationId) {
      const submission = await readSubmissionReceipt(loaded, record.request.submissionOperationId);
      if (submission?.events?.some((event) => event.kind === "stop-requested")) {
        throw new ProjectFileRepositoryError("AGENT_STOP_PENDING", "Stop was accepted before this result; awaiting confirmed cleanup.");
      }
    }
    const outputHtml = String(html || "");
    try {
      requireCompleteHtml(outputHtml, "Candidate HTML");
    } catch (cause) {
      return this.#recordRequestValidationError({
        loaded,
        record,
        cause,
        previewHtml: outputHtml,
      });
    }
    const outputSha256 = sha256(Buffer.from(outputHtml, "utf8"));
    if (record.status === "candidate-ready" || record.status === "promoted") {
      const candidate = await this.#readCandidateForLoaded(loaded, record.candidateId);
      if (
        (candidate.candidate.submittedOutputSha256 ?? candidate.output.sha256)
        !== outputSha256
      ) {
        throw new ProjectFileRepositoryError(
          "REQUEST_OUTPUT_CHANGED",
          "The finalized Candidate output changed after review began.",
        );
      }
      await this.#publishAiTaskProjectionIfPossible({
        target,
        requestId: record.requestId,
        attemptId: record.attemptId,
        candidateId: record.candidateId,
      });
      return {
        status: record.status === "promoted" ? "promoted" : "candidate-ready",
        request: this.#publicRequest(record, loaded.paths.projectRootPath),
        candidate: structuredClone(candidate.candidate),
      };
    }
    if (record.status === "no-change") {
      return {
        status: "no-change",
        request: this.#publicRequest(record, loaded.paths.projectRootPath),
      };
    }
    const frozenInput = await readHtmlFile(
      resolveRelative(
        loaded.paths.controlRoot,
        record.inputRelativePath,
        "frozen Request input path",
      ),
      "frozen Request input",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (frozenInput.sha256 !== record.expectedSourceSha256) {
      throw new ProjectFileRepositoryError(
        "FROZEN_INPUT_HASH_MISMATCH",
        "The frozen Request input changed after submission.",
      );
    }
    const requestTargets = Array.isArray(record.request?.taskSpec?.targets)
      ? record.request.taskSpec.targets
      : Array.isArray(record.request?.targets)
        ? record.request.targets
        : [];
    const commentTargets = Array.isArray(record.request?.comments)
      ? record.request.comments
        .map((comment) => comment?.sourceAnchor || comment?.target)
        .filter(Boolean)
      : [];
    const allRequestedTargetRefs = [...requestTargets, ...commentTargets];
    const requestedTargetElementIds = [...new Set(
      allRequestedTargetRefs
        .map((targetRef) => targetRef?.elementId)
        .filter((elementId) => isValidStemmioElementId(elementId)),
    )].sort();
    const requestedTargetCount = new Set(
      allRequestedTargetRefs.map((targetRef, index) => {
        if (!isObject(targetRef)) return `target-index:${index}`;
        return String(
          targetRef.targetId
          || targetRef.id
          || targetRef.elementId
          || `${targetRef.level || ""}:${targetRef.selector || ""}:${index}`,
        );
      }),
    ).size;
    const requestedTargetIsPage = allRequestedTargetRefs.some(isPageTargetReference);
    let prepared;
    try {
      prepared = await this.#createCandidate({
        target,
        requestId: record.requestId,
        attemptId: record.attemptId,
        candidateId: record.candidateId,
        html: outputHtml,
        expectedSourceSha256: record.expectedSourceSha256,
        candidateIdentity: {
          proposedVersionId: record.proposedVersionId,
          proposedVersionOrdinal: record.proposedVersionOrdinal,
          basedOnVersionId: record.basedOnVersionId,
          previousVersionId: record.previousVersionId,
        },
        assessmentBaseHtml: frozenInput.html,
        allowSourceDivergence: true,
        requestedTargetElementIds,
        requestedTargetCount,
        requestedTargetIsPage,
        inputManifestSha256: record.inputManifestSha256,
      });
    } catch (cause) {
      if (!mapCandidateValidationError(cause) && cause?.code !== "CANDIDATE_UNUSABLE") {
        throw cause;
      }
      return this.#recordRequestValidationError({
        loaded,
        record,
        cause,
        previewHtml: outputHtml,
      });
    }
    record.status = "candidate-ready";
    record.completedAt = nowIso(this.#clock);
    await this.#writeRequestWithHistory(loaded, requestPath, record);
    await this.#publishAiTaskProjectionIfPossible({
      target,
      requestId: record.requestId,
      attemptId: record.attemptId,
      candidateId: record.candidateId,
    });
    return {
      status: "candidate-ready",
      request: this.#publicRequest(record, loaded.paths.projectRootPath),
      candidate: structuredClone(prepared.candidate),
    };
  }

  async #assertProjectsRoot() {
    const information = await directoryInformation(
      this.#projectsRoot,
      "configured project directory",
    );
    if (!information) {
      throw new ProjectFileRepositoryError(
        "PROJECTS_ROOT_NOT_FOUND",
        "The configured Stemmio project directory is unavailable.",
      );
    }
    return information;
  }

  async #assertRegisteredProjectRootPath(projectRootPath, { allowMissing = false } = {}) {
    await this.#assertProjectsRoot();
    const root = normalizedPath(projectRootPath);
    if (!samePath(path.dirname(root), this.#projectsRoot) || path.basename(root).startsWith(".")) {
      throw new ProjectFileRepositoryError(
        "UNREGISTERED_PROJECT_ROOT",
        "A managed project root must be a direct child of the configured project directory.",
        { projectRootPath: root },
      );
    }
    const information = await directoryInformation(root, "registered project root", {
      projectRootPath: this.#projectsRoot,
    });
    if (!information && !allowMissing) {
      throw new ProjectFileRepositoryError(
        "REGISTERED_PROJECT_UNAVAILABLE",
        "The registered project root is unavailable.",
        { projectRootPath: root },
      );
    }
    return { projectRootPath: root, information };
  }

  async #writeRegistry(registry) {
    await this.#assertProjectsRoot();
    assertRegistry(registry);
    registry.updatedAt = nowIso(this.#clock);
    await atomicWriteProjectJson(
      this.#projectsRoot,
      this.#registryPath,
      registry,
      "project registry",
    );
  }

  async #preparePendingImport({
    projectId,
    documentId,
    projectRootPath,
    createdAt,
    importSourceKey,
    importSourceSha256,
  }) {
    const target = await this.#assertRegisteredProjectRootPath(projectRootPath, {
      allowMissing: true,
    });
    if (target.information) {
      throw new ProjectFileRepositoryError(
        "PROJECT_DIRECTORY_COLLISION",
        "The selected project directory is already occupied.",
      );
    }
    const registry = await this.#readRegistry();
    if (registry.projects[projectId] || registry.pendingImports[projectId]) {
      throw new ProjectFileRepositoryError(
        "PROJECT_ID_COLLISION",
        "The new project identity is already registered.",
      );
    }
    const sourceClaims = this.#externalSourceClaims(registry, importSourceKey);
    if (sourceClaims.committed.length > 0 || sourceClaims.pending.length > 0) {
      throw new ProjectFileRepositoryError(
        "EXTERNAL_SOURCE_BINDING_CONFLICT",
        "This external source is already claimed by a registered or pending project.",
      );
    }
    registry.pendingImports[projectId] = {
      projectId,
      documentId,
      registeredProjectRootPath: target.projectRootPath,
      createdAt,
      importSourceKey: assertSha256(importSourceKey, "importSourceKey"),
      importSourceSha256: assertSha256(importSourceSha256, "importSourceSha256"),
    };
    await this.#writeRegistry(registry);
  }

  async #clearPendingImportIfMatches(projectId, projectRootPath) {
    const registry = await this.#readRegistry();
    const pending = registry.pendingImports[projectId];
    if (
      !pending
      || !samePath(pending.registeredProjectRootPath, projectRootPath)
    ) return false;
    delete registry.pendingImports[projectId];
    await this.#writeRegistry(registry);
    return true;
  }

  async #publishPendingImport(projectId) {
    const registry = await this.#readRegistry();
    const pending = registry.pendingImports[projectId];
    if (!pending) {
      const existing = registry.projects[projectId];
      if (!existing) {
        throw new ProjectFileRepositoryError(
          "IMPORT_INTENT_NOT_FOUND",
          "The import has no registered publication intent.",
          { projectId },
        );
      }
      return existing;
    }
    const target = await this.#assertRegisteredProjectRootPath(
      pending.registeredProjectRootPath,
    );
    const loaded = await this.#loadProject(target.projectRootPath);
    if (
      loaded.project.projectId !== pending.projectId
      || loaded.project.documentId !== pending.documentId
    ) {
      throw new ProjectFileRepositoryError(
        "IMPORT_IDENTITY_MISMATCH",
        "The published import does not match its Registry intent.",
        { projectId },
      );
    }
    const rootFileIdentity = copyFileIdentity(target.information);
    const existing = registry.projects[projectId];
    if (existing) {
      if (
        !samePath(existing.registeredProjectRootPath, target.projectRootPath)
      ) {
        throw new ProjectFileRepositoryError(
          "IMPORT_REGISTRY_CONFLICT",
          "The import intent conflicts with an existing registered project.",
          { projectId },
        );
      }
    } else {
      registry.projects[projectId] = {
        registeredProjectRootPath: target.projectRootPath,
        rootFileIdentity,
        updatedAt: nowIso(this.#clock),
        ...(pending.importSourceKey && pending.importSourceSha256
          ? {
            importSourceKey: pending.importSourceKey,
            importSourceSha256: pending.importSourceSha256,
          }
          : {}),
      };
      await this.#writeRegistry(registry);
    }

    const importPath = path.join(loaded.paths.recoveryRoot, "import.json");
    const importRecord = await readJsonFile(importPath, "import recovery record", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (
      !importRecord
      || importRecord.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || importRecord.kind !== "import"
      || importRecord.projectId !== pending.projectId
      || importRecord.documentId !== pending.documentId
    ) {
      throw new ProjectFileRepositoryError(
        "IMPORT_RECOVERY_INVALID",
        "The published import recovery record is invalid.",
        { projectId },
      );
    }
    if (importRecord.state !== "committed") {
      await atomicWriteProjectJson(loaded.paths.projectRootPath, importPath, {
        ...importRecord,
        state: "committed",
        committedAt: nowIso(this.#clock),
      }, "import recovery record");
    }

    const latest = await this.#readRegistry();
    const latestPending = latest.pendingImports[projectId];
    const latestProject = latest.projects[projectId];
    if (
      latestPending
      && latestProject
      && samePath(
        latestPending.registeredProjectRootPath,
        latestProject.registeredProjectRootPath,
      )
    ) {
      delete latest.pendingImports[projectId];
      await this.#writeRegistry(latest);
    }
    return (await this.#readRegistry()).projects[projectId];
  }

  // Recovery has one authority: a Registry pending-import record. A copied
  // half-finished directory cannot gain management merely because it contains
  // a plausible .stemmio/recovery/import.json.
  async #recoverPublishedImports() {
    const registry = await this.#readRegistry();
    const recovered = [];
    for (const projectId of Object.keys(registry.pendingImports)) {
      try {
        await this.#publishPendingImport(projectId);
        recovered.push(projectId);
      } catch {
        // Invalid or user-altered directories remain unmanaged. The Registry
        // intent is retained for an explicit, auditable recovery path.
      }
    }
    return recovered;
  }

  async #readExternalSourceDescriptor(sourcePath, { beforeRead = null } = {}) {
    const requestedPath = normalizedPath(sourcePath);
    htmlExtension(requestedPath);
    const information = await regularInformation(requestedPath, "external HTML");
    if (!information) {
      throw new ProjectFileRepositoryError(
        "SOURCE_NOT_FOUND",
        "external HTML was not found.",
      );
    }
    const canonicalSourcePath = normalizedPath(await cachedRealPath(requestedPath));
    htmlExtension(canonicalSourcePath);
    const source = await readHtmlFile(canonicalSourcePath, "external HTML", {
      beforeRead,
    });
    return {
      canonicalSourcePath,
      sourceKey: sha256(Buffer.from(canonicalSourcePath, "utf8")),
      sourceSha256: source.sha256,
      buffer: source.buffer,
      html: source.html,
      information: source.information,
    };
  }

  #externalSourceClaims(registry, sourceKey) {
    const committed = [];
    const pending = [];
    for (const [projectId, record] of Object.entries(registry.projects)) {
      if (record.importSourceKey === sourceKey) {
        committed.push({ projectId, record });
      }
    }
    for (const [projectId, record] of Object.entries(registry.pendingImports)) {
      if (record.importSourceKey === sourceKey) {
        pending.push({ projectId, record });
      }
    }
    return { committed, pending };
  }

  async #externalSourceProjectFacts({ projectId, record, currentSourceSha256, readOnly = false }) {
    const loaded = await this.#loadRegisteredProject({ projectId, readOnly });
    const active = await this.#activeRegisteredWorkingCopy(loaded);
    const resolved = await this.#resolveWorkingCopyPath(loaded, active, "current draft", { readOnly, persistLocator: !readOnly });
    const opened = { target: publicOpenTarget({ project: loaded.project, projectRootPath: loaded.paths.projectRootPath, targetKind: "working-copy", workingCopy: active, exactSourcePath: resolved.exactSourcePath, sourceSha256: resolved.source.sha256 }) };
    const workingCopy = await this.#activeRegisteredWorkingCopy(loaded);
    const state = assertWorkingCopyState(
      await readJsonFile(
        workingCopyStatePath(loaded.paths, workingCopy),
        "active Working Copy state",
        { projectRootPath: loaded.paths.projectRootPath },
      ),
      loaded,
      workingCopy,
    );
    const basedOnVersion = loaded.manifest.versions.find(
      (version) => version.versionId === workingCopy.basedOnVersionId,
    );
    const latestVersion = loaded.manifest.versions.find(
      (version) => version.versionId === loaded.manifest.latestOfficialVersionId,
    );
    const initialVersion = loaded.manifest.versions.find((version) => version.ordinal === 1);
    if (
      !basedOnVersion
      || !latestVersion
      || !initialVersion
      || initialVersion.ordinal !== 1
      || initialVersion.contentSha256 !== record.importSourceSha256
    ) {
      throw new ProjectFileRepositoryError(
        "EXTERNAL_SOURCE_BINDING_INVALID",
        "The bound project no longer has a valid initial Version for this external source.",
        { projectId },
      );
    }
    const snapshot = await readHtmlFile(
      versionSnapshotPath(loaded.paths, initialVersion),
      "initial Version snapshot",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (snapshot.sha256 !== record.importSourceSha256) {
      throw new ProjectFileRepositoryError(
        "EXTERNAL_SOURCE_BINDING_INVALID",
        "The bound project's initial Version snapshot does not match the recorded import.",
        { projectId },
      );
    }
    return {
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      projectName: path.basename(loaded.paths.projectRootPath),
      openTarget: opened.target,
      currentBasedOnVersionId: basedOnVersion.versionId,
      currentBasedOnOrdinal: basedOnVersion.ordinal,
      latestOfficialVersionId: latestVersion.versionId,
      latestOfficialOrdinal: latestVersion.ordinal,
      currentDiffersFromBase: state.differsFromBase === true,
      initialVersionId: initialVersion.versionId,
      initialVersionOrdinal: initialVersion.ordinal,
      sourceRelation: currentSourceSha256 === record.importSourceSha256
        ? "unchanged"
        : "changed",
    };
  }

  async #resolveExternalSourceBinding({ sourceKey, currentSourceSha256, readOnly = false }) {
    const registry = await this.#readRegistry();
    const claims = this.#externalSourceClaims(registry, sourceKey);
    if (claims.committed.length > 1) {
      throw new ProjectFileRepositoryError(
        "EXTERNAL_SOURCE_BINDING_CONFLICT",
        "More than one registered project claims this external source.",
      );
    }
    if (
      claims.committed.length === 1
      && claims.pending.some((item) => item.projectId !== claims.committed[0].projectId)
    ) {
      throw new ProjectFileRepositoryError(
        "EXTERNAL_SOURCE_BINDING_CONFLICT",
        "A pending import conflicts with the registered external source binding.",
      );
    }
    if (claims.committed.length === 1) {
      return this.#externalSourceProjectFacts({
        projectId: claims.committed[0].projectId,
        record: claims.committed[0].record,
        currentSourceSha256, readOnly,
      });
    }
    if (claims.pending.length > 1) {
      throw new ProjectFileRepositoryError(
        "EXTERNAL_SOURCE_BINDING_CONFLICT",
        "More than one pending import claims this external source.",
      );
    }
    return null;
  }

  async #recoverOrClearPendingExternalSource(sourceKey, currentSourceSha256) {
    const registry = await this.#readRegistry();
    const claims = this.#externalSourceClaims(registry, sourceKey);
    if (claims.pending.length !== 1 || claims.committed.length > 0) return null;
    const pending = claims.pending[0];
    try {
      await this.#publishPendingImport(pending.projectId);
    } catch (cause) {
      const pendingRoot = await directoryInformation(
        pending.record.registeredProjectRootPath,
        "pending import root",
        { projectRootPath: this.#projectsRoot },
      );
      if (!pendingRoot) {
        await this.#clearPendingImportIfMatches(
          pending.projectId,
          pending.record.registeredProjectRootPath,
        );
        return null;
      }
      throw new ProjectFileRepositoryError(
        "SOURCE_IMPORT_PENDING",
        "A previous import of this external source is still pending recovery.",
        { projectId: pending.projectId, cause: cause?.code || null },
      );
    }
    return this.#resolveExternalSourceBinding({
      sourceKey,
      currentSourceSha256,
    });
  }

  async #classifyOpenPath({ sourcePath }) {
    const requestedPath = normalizedPath(sourcePath);
    htmlExtension(requestedPath);
    const managedTarget = await this.#resolveOpenTarget({ sourcePath: requestedPath, readOnly: true });
    if (managedTarget) {
      return {
        kind: "managed-project",
        target: managedTarget,
        sourceSha256: managedTarget.sourceSha256,
      };
    }
    const descriptor = await this.#readExternalSourceDescriptor(requestedPath);
    const binding = await this.#resolveExternalSourceBinding({
      readOnly: true, sourceKey: descriptor.sourceKey,
      currentSourceSha256: descriptor.sourceSha256,
    });
    if (binding) {
      return {
        kind: "known-external",
        sourceSha256: descriptor.sourceSha256,
        sourceRelation: binding.sourceRelation,
        projectFacts: binding,
      };
    }
    const stem = safeProjectName(descriptor.canonicalSourcePath);
    const extension = htmlExtension(descriptor.canonicalSourcePath);
    return {
      kind: "new-external",
      sourceSha256: descriptor.sourceSha256,
      sourceFileName: path.basename(descriptor.canonicalSourcePath),
      visibleV1FileName: `${stem}${extension}`,
    };
  }

  async #importExternal({
    sourcePath,
    expectedSourceSha256,
  }) {
    await ensureDirectory(this.#projectsRoot);
    await this.#assertProjectsRoot();
    await this.#readRegistry();
    return this.#withRegistryWriteLock(async () => {
      await this.#recoverPublishedImports();
      const requestedPath = normalizedPath(sourcePath);
      htmlExtension(requestedPath);
      const existingTarget = await this.#resolveOpenTarget({ sourcePath: requestedPath });
      if (existingTarget) return { imported: false, target: existingTarget };
      const descriptor = await this.#readExternalSourceDescriptor(requestedPath, {
        beforeRead: ({ filePath, information }) => this.#hit("html-read-after-stat", {
          filePath,
          size: information.size,
        }),
      });
      if (
        expectedSourceSha256
        && descriptor.sourceSha256 !== assertSha256(expectedSourceSha256, "expectedSourceSha256")
      ) {
        throw new ProjectFileRepositoryError(
          "SOURCE_HASH_CONFLICT",
          "The external HTML changed before import.",
          {
            expectedSourceSha256,
            actualSourceSha256: descriptor.sourceSha256,
          },
        );
      }
      const bound = await this.#resolveExternalSourceBinding({
        sourceKey: descriptor.sourceKey,
        currentSourceSha256: descriptor.sourceSha256,
      });
      if (bound) return { imported: false, target: bound.openTarget };
      const recoveredPending = await this.#recoverOrClearPendingExternalSource(
        descriptor.sourceKey,
        descriptor.sourceSha256,
      );
      if (recoveredPending) {
        return { imported: false, target: recoveredPending.openTarget };
      }
      return this.#publishNewExternalImport(descriptor);
    });
  }

  async #publishNewExternalImport(descriptor) {
    const stem = safeProjectName(descriptor.canonicalSourcePath);
    const extension = htmlExtension(descriptor.canonicalSourcePath);
    const identifiedWorkingCopy = materializeSourceElementIdentity(descriptor.html);
    const identifiedWorkingCopySha256 = sha256(identifiedWorkingCopy.buffer);
    const projectId = randomId("project");
    const documentId = randomId("doc");
    const createdAt = nowIso(this.#clock);
    const allocated = await this.#allocateProjectRoot(stem);
    const stagingRoot = path.join(
      this.#projectsRoot,
      importTemporaryName(`${allocated.directoryName}-${randomUUID()}`),
    );
    const paths = projectPaths(stagingRoot);
    let published = false;
    let pendingPrepared = false;
    try {
      await this.#preparePendingImport({
        projectId,
        documentId,
        projectRootPath: allocated.projectRootPath,
        createdAt,
        importSourceKey: descriptor.sourceKey,
        importSourceSha256: descriptor.sourceSha256,
      });
      pendingPrepared = true;
      await this.#hit("import-intent-recorded", {
        projectRootPath: allocated.projectRootPath,
        projectId,
      });
      await ensureDirectory(stagingRoot);
      for (const directory of [
        paths.controlRoot,
        paths.versionsRoot,
        paths.workingCopiesRoot,
        paths.draftsRoot,
        paths.requestsRoot,
        paths.transactionsRoot,
        paths.recoveryRoot,
      ]) await ensureDirectory(directory);
      await this.#hit("import-directories-created", { stagingRoot });

      const firstVersionId = versionId(1);
      const firstWorkingCopyId = workingCopyId(1);
      const visibleName = `${stem}${extension}`;
      const visiblePath = path.join(stagingRoot, visibleName);
      const snapshotRelativePath = `versions/${firstVersionId}/index.html`;
      const snapshotPath = resolveRelative(
        paths.controlRoot,
        snapshotRelativePath,
        "snapshotRelativePath",
      );
      await ensureProjectDirectory(
        stagingRoot,
        path.dirname(snapshotPath),
        "initial Version directory",
      );
      await atomicWriteProjectFile(stagingRoot, snapshotPath, descriptor.buffer, "initial Version snapshot");
      await this.#hit("import-snapshot-written", { stagingRoot });
      await atomicWriteProjectFile(
        stagingRoot,
        visiblePath,
        identifiedWorkingCopy.buffer,
        "initial Working Copy",
      );
      const visibleInformation = await regularInformation(visiblePath, "initial Working Copy", {
        projectRootPath: stagingRoot,
      });
      await this.#hit("import-working-copy-written", { stagingRoot });

      const project = {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        projectId,
        documentId,
        createdAt,
      };
      const firstVersion = {
        versionId: firstVersionId,
        ordinal: 1,
        basedOnVersionId: null,
        previousVersionId: null,
        contentSha256: descriptor.sourceSha256,
        snapshotRelativePath,
        sourceRequestId: null,
        sourceCandidateId: null,
        createdAt,
      };
      const firstWorkingCopy = {
        workingCopyId: firstWorkingCopyId,
        versionId: firstVersionId,
        basedOnVersionId: firstVersionId,
        sourceRelativePath: visibleName,
        preferredFileStem: stem,
        preferredExtension: extension,
        stateRelativePath: `working-copies/${firstWorkingCopyId}.json`,
        fileIdentity: copyFileIdentity(visibleInformation),
      };
      const manifest = {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        projectId,
        documentId,
        latestOfficialVersionId: firstVersionId,
        currentDraftSchemaVersion: CURRENT_DRAFT_SCHEMA_VERSION,
        versions: [firstVersion],
        workingCopies: [firstWorkingCopy],
      };
      const workingState = {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        projectId,
        documentId,
        workingCopyId: firstWorkingCopyId,
        basedOnVersionId: firstVersionId,
        baseSha256: descriptor.sourceSha256,
        currentSha256: identifiedWorkingCopySha256,
        snapshotBaselineSha256: identifiedWorkingCopySha256,
        differsFromBase: identifiedWorkingCopySha256 !== descriptor.sourceSha256,
        draftId: `draft_${firstWorkingCopyId}`,
        draftRelativePath: draftRelativePathFor(firstWorkingCopy),
        draftSha256: null,
        draftRevision: 0,
        saveState: "saved",
        lastPersistedRevision: 0,
        lastSavedAt: createdAt,
        lastOpenedAt: createdAt,
        sourceElementIdentitySchemaVersion: STEMMIO_ELEMENT_ID_SCHEMA_VERSION,
        sourceElementIdentityBindingSha256:
          sourceElementIdentityBindingSha256(identifiedWorkingCopy.identity),
      };
      const runtime = {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        projectId,
        documentId,
        activeWorkingCopyId: firstWorkingCopyId,
        activeRequest: null,
        activeCandidateId: null,
        lastAiTask: null,
      };
      await atomicWriteProjectJson(stagingRoot, paths.projectPath, project, "project.json");
      await atomicWriteProjectJson(stagingRoot, paths.manifestPath, manifest, "manifest.json");
      await atomicWriteProjectJson(
        stagingRoot,
        workingCopyStatePath(paths, firstWorkingCopy),
        workingState,
        "initial Working Copy state",
      );
      await writeRuntimeState(stagingRoot, paths.runtimePath, runtime);
      await atomicWriteProjectJson(stagingRoot, path.join(paths.recoveryRoot, "import.json"), {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        kind: "import",
        state: "prepared",
        projectId,
        documentId,
        externalSourceSha256: descriptor.sourceSha256,
        createdAt,
      }, "import recovery record");
      await atomicWriteProjectFile(
        stagingRoot,
        path.join(stagingRoot, "PROJECT.md"),
        Buffer.from(DEFAULT_PROJECT_RULES_TEMPLATE, "utf8"),
        "PROJECT.md",
      );
      await this.#hit("import-metadata-written", { stagingRoot });

      const sourceBeforePublish = await this.#readExternalSourceDescriptor(
        descriptor.canonicalSourcePath,
      );
      if (sourceBeforePublish.sourceSha256 !== descriptor.sourceSha256) {
        throw new ProjectFileRepositoryError(
          "SOURCE_HASH_CONFLICT",
          "The external HTML changed during import.",
          {
            expectedSourceSha256: descriptor.sourceSha256,
            actualSourceSha256: sourceBeforePublish.sourceSha256,
          },
        );
      }
      await rename(stagingRoot, allocated.projectRootPath);
      await syncDirectory(this.#projectsRoot);
      published = true;
      await this.#hit("import-project-published", {
        projectRootPath: allocated.projectRootPath,
        projectId,
      });
      await this.#publishPendingImport(projectId);
      await refreshSourceBinding(allocated.projectRootPath, firstWorkingCopy.workingCopyId,
        path.join(allocated.projectRootPath, visibleName), identifiedWorkingCopySha256);
      await this.#hit("import-registry-written", {
        projectRootPath: allocated.projectRootPath,
        projectId,
      });
      return {
        imported: true,
        importSourceSha256: descriptor.sourceSha256,
        target: publicOpenTarget({
          project,
          projectRootPath: allocated.projectRootPath,
          targetKind: "working-copy",
          workingCopy: firstWorkingCopy,
          version: firstVersion,
          exactSourcePath: path.join(allocated.projectRootPath, visibleName),
          sourceSha256: identifiedWorkingCopySha256,
        }),
      };
    } catch (cause) {
      if (!published) {
        await rm(stagingRoot, { recursive: true, force: true });
        if (pendingPrepared) {
          await this.#clearPendingImportIfMatches(
            projectId,
            allocated.projectRootPath,
          ).catch(() => {});
        }
      }
      throw cause;
    }
  }

  async #allocateProjectRoot(stem) {
    for (let ordinal = 1; ordinal < 10000; ordinal += 1) {
      const directoryName = projectDirectoryName(stem, ordinal);
      const candidate = path.join(this.#projectsRoot, directoryName);
      // Allocation is a collision probe, not a request to trust or inspect an
      // existing entry. Files, directories and symlinks all reserve the name
      // and are skipped without turning a harmless placeholder into an unsafe
      // directory error.
      const occupied = await lstat(candidate).catch((cause) => {
        if (cause?.code === "ENOENT") return null;
        throw cause;
      });
      if (!occupied) {
        return { directoryName, projectRootPath: candidate };
      }
    }
    throw new ProjectFileRepositoryError(
      "PROJECT_DIRECTORY_COLLISION",
      "A unique project folder could not be allocated.",
    );
  }

  async #loadProject(projectRootPath) {
    const root = normalizedPath(projectRootPath);
    const paths = projectPaths(root);
    if (!(await directoryInformation(root, "project root"))) {
      throw new ProjectFileRepositoryError(
        "PROJECT_ROOT_NOT_FOUND",
        "The project folder is no longer available.",
        { projectRootPath: root },
      );
    }
    if (!(await directoryInformation(paths.controlRoot, PROJECT_CONTROL_DIRECTORY_NAME, {
      projectRootPath: root,
    }))) {
      throw new ProjectFileRepositoryError(
        "PROJECT_CONTROL_NOT_FOUND",
        "The project folder no longer contains its Stemmio identity.",
        { projectRootPath: root },
      );
    }
    for (const [directoryPath, label] of [
      [paths.versionsRoot, "versions"],
      [paths.workingCopiesRoot, "working-copies"],
      [paths.draftsRoot, "drafts"],
      [paths.requestsRoot, "requests"],
      [paths.transactionsRoot, "transactions"],
      [paths.recoveryRoot, "recovery"],
    ]) {
      if (!(await directoryInformation(directoryPath, label, {
        projectRootPath: root,
      }))) {
        throw new ProjectFileRepositoryError(
          "PROJECT_CONTROL_NOT_FOUND",
          `The project folder has no ${label} directory.`,
          { projectRootPath: root },
        );
      }
    }
    const project = assertProjectIdentity(await readJsonFile(paths.projectPath, "project.json", {
      projectRootPath: root,
    }));
    const manifest = assertManifest(
      await readJsonFile(paths.manifestPath, "manifest.json", {
        projectRootPath: root,
      }),
      project,
    );
    const runtime = assertRuntime(
      await readJsonFile(paths.runtimePath, "runtime-state.json", {
        projectRootPath: root,
      }),
      project,
      manifest,
    );
    return { paths, project, manifest, runtime };
  }

  async #registeredRootCensus() {
    const pathsByProjectId = new Map();
    const incompletePathsByProjectId = new Map();
    let entries;
    try {
      entries = await readdir(this.#projectsRoot, { withFileTypes: true });
    } catch (error) {
      // Catalog rows retain their individual unavailable/error projection when
      // the common directory cannot be scanned. Formal discovery still throws.
      return { pathsByProjectId, error };
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
      const candidatePath = path.join(this.#projectsRoot, entry.name);
      try {
        const project = (await this.#loadProject(candidatePath)).project;
        const paths = pathsByProjectId.get(project.projectId) || [];
        paths.push(candidatePath);
        pathsByProjectId.set(project.projectId, paths);
      } catch {
        // Keep a valid project identity even when the remaining control files
        // are damaged, so a matching but incomplete copy stays visible as an
        // invalid/unavailable project rather than being mistaken for absence.
        try {
          const project = assertProjectIdentity(await readJsonFile(
            projectControlPath(candidatePath, "project.json"), "project.json",
            { projectRootPath: candidatePath },
          ));
          const paths = incompletePathsByProjectId.get(project.projectId) || [];
          paths.push(candidatePath);
          incompletePathsByProjectId.set(project.projectId, paths);
        } catch {
          // Unrelated malformed folders cannot prevent a registered project opening.
        }
      }
    }
    return { pathsByProjectId, incompletePathsByProjectId, error: null };
  }

  async #discoverRegisteredRoot(projectId, record, { documentId = null, rootCensus = null } = {}) {
    const registeredRootPath = normalizedPath(record.registeredProjectRootPath);
    const registered = await this.#assertRegisteredProjectRootPath(registeredRootPath, { allowMissing: true });
    if (registered.information) await this.#loadProject(registeredRootPath);
    // The census is a query-local identity hint, never a validated Project.
    // Keep all candidates and validate their complete current contracts before
    // declaring a unique identity, even while the registered name still exists.
    const census = rootCensus || await this.#registeredRootCensus();
    if (census.error) throw census.error;
    const candidates = [];
    for (const candidatePath of census.pathsByProjectId.get(projectId) || []) {
      try {
        const loaded = await this.#loadProject(candidatePath);
        if (loaded.project.projectId === projectId) {
          candidates.push({ candidatePath, project: loaded.project });
        }
      } catch {
        // Malformed/unavailable candidates remain isolated as before.
      }
    }
    if (candidates.length > 1) {
      throw new ProjectFileRepositoryError("REGISTERED_PROJECT_AMBIGUOUS", "存在相同项目身份的多个文件夹，请移走多余副本后重新检查。", { projectId });
    }
    const chosen = candidates[0];
    if (!chosen) {
      const incomplete = census.incompletePathsByProjectId?.get(projectId) || [];
      if (incomplete.length > 0) {
        throw new ProjectFileRepositoryError(
          "INVALID_MANIFEST",
          "登记项目文件夹存在但合同不完整，暂时不可用。",
          { projectId, projectRootPath: incomplete[0], confirmedAbsent: false },
        );
      }
      return null;
    }
    if (documentId && chosen.project.documentId !== documentId) {
      throw new ProjectFileRepositoryError("PROJECT_IDENTITY_CHANGED", "项目文档身份不匹配。", { projectId });
    }
    // Load the complete contract before recording any root relocation.
    await this.#loadProject(chosen.candidatePath);
    const current = await this.#assertRegisteredProjectRootPath(chosen.candidatePath);
    const observedIdentity = copyFileIdentity(current.information);
    return { projectRootPath: chosen.candidatePath, observedIdentity };
  }

  async #recoverRegisteredRootRename(projectId, record, options = {}) {
    return this.#withRegistryWriteLock(async () => {
      const latestRecord = (await this.#readRegistry()).projects[projectId];
      if (!latestRecord) return null;
      record = latestRecord;
      const found = await this.#discoverRegisteredRoot(projectId, record, options);
      if (!found) return null;
      if (!samePath(record.registeredProjectRootPath, found.projectRootPath)
        || JSON.stringify(record.rootFileIdentity) !== JSON.stringify(found.observedIdentity)) {
        const latest = await this.#readRegistry();
        const latestRecord = latest.projects[projectId];
        if (!latestRecord || JSON.stringify(latestRecord) !== JSON.stringify(record)) {
          throw new ProjectFileRepositoryError("REGISTERED_PROJECT_RACE", "项目登记在恢复过程中发生变化。", { projectId });
        }
        latestRecord.registeredProjectRootPath = found.projectRootPath;
        latestRecord.rootFileIdentity = found.observedIdentity;
        latestRecord.updatedAt = nowIso(this.#clock);
        await this.#writeRegistry(latest);
      }
      return found.projectRootPath;
    });
  }

  async #loadRegisteredProject({
    projectId,
    documentId = null,
    declaredProjectRootPath = null,
    readOnly = false,
    rootCensus = null,
  }) {
    const id = assertId(projectId, PROJECT_ID, "projectId");
    const expectedDocumentId = documentId
      ? assertId(documentId, DOCUMENT_ID, "documentId")
      : null;
    const registry = await this.#readRegistry();
    const record = registry.projects[id];
    if (!record) {
      throw new ProjectFileRepositoryError(
        "REGISTERED_PROJECT_UNAVAILABLE",
        "This project is no longer registered for Stemmio writes.",
        { projectId: id },
      );
    }
    if (
      declaredProjectRootPath
      && !samePath(declaredProjectRootPath, record.registeredProjectRootPath)
    ) {
      throw new ProjectFileRepositoryError(
        "REGISTERED_PROJECT_PATH_MISMATCH",
        "The supplied project path is not the registered Stemmio project root.",
        {
          projectId: id,
          registeredProjectRootPath: record.registeredProjectRootPath,
        },
      );
    }
    const projectRootPath = readOnly
      ? (await this.#discoverRegisteredRoot(id, record, { documentId: expectedDocumentId, rootCensus }))?.projectRootPath
      : await this.#recoverRegisteredRootRename(id, record, { documentId: expectedDocumentId });
    if (!projectRootPath) {
      throw new ProjectFileRepositoryError(
        "REGISTERED_PROJECT_UNAVAILABLE",
        "The registered project is temporarily unavailable; its in-memory changes remain retained.",
        {
          projectId: id,
          registeredProjectRootPath: record.registeredProjectRootPath,
          confirmedAbsent: true,
        },
      );
    }
    const loaded = await this.#loadProject(projectRootPath);
    if (
      loaded.project.projectId !== id
      || (expectedDocumentId && loaded.project.documentId !== expectedDocumentId)
    ) {
      throw new ProjectFileRepositoryError(
        "PROJECT_IDENTITY_CHANGED",
        "The registered project root no longer matches the active document identity.",
        { projectId: id, projectRootPath },
      );
    }
    return loaded;
  }

  async #registeredProjectForSource(sourcePath, { readOnly = false } = {}) {
    const exactSourcePath = normalizedPath(sourcePath);
    const registry = await this.#readRegistry();
    const candidates = [];
    for (const [projectId, record] of Object.entries(registry.projects)) {
      let resolvedRoot;
      try {
        resolvedRoot = readOnly
          ? (await this.#discoverRegisteredRoot(projectId, record))?.projectRootPath
          : await this.#recoverRegisteredRootRename(projectId, record);
      } catch (cause) {
        // A v4 project only owns an HTML after its root, stable identity and
        // on-disk contract all validate. A damaged record is therefore not an
        // opening target, even for a file beneath its former root: callers
        // can import that HTML as a fresh V1 instead of migrating or repairing
        // pre-v4 state.
        if (!pathInside(record.registeredProjectRootPath, exactSourcePath)) {
          const candidate = await readJsonFile(projectControlPath(path.dirname(exactSourcePath), "project.json"), "project.json").catch(() => null);
          if (candidate?.projectId !== projectId) continue;
        }
        if (invalidRegisteredProjectError(cause)) continue;
        throw cause;
      }
      if (resolvedRoot && pathInside(resolvedRoot, exactSourcePath)) {
        candidates.push({ projectId, projectRootPath: resolvedRoot });
      }
    }
    if (candidates.length > 1) {
      throw new ProjectFileRepositoryError(
        "MANAGED_PATH_AMBIGUOUS",
        "More than one registered project claims this HTML path.",
        { sourcePath: exactSourcePath, projectIds: candidates.map((item) => item.projectId) },
      );
    }
    if (candidates.length === 0) return null;
    try {
      return await this.#loadRegisteredProject({
        projectId: candidates[0].projectId,
        ...(readOnly ? { readOnly: true } : { declaredProjectRootPath: candidates[0].projectRootPath }),
      });
    } catch (cause) {
      if (invalidRegisteredProjectError(cause)) return null;
      throw cause;
    }
  }

  #registeredProjectCatalogFallback(projectId, record, availability) {
    return {
      projectId,
      documentId: null,
      projectName: path.basename(record.registeredProjectRootPath),
      registeredProjectRootPath: record.registeredProjectRootPath,
      activeWorkingCopyId: null,
      activeSourcePath: null,
      currentBasedOnVersionId: null,
      latestOfficialVersionId: null,
      hasPendingCandidate: false,
      availability,
      availabilityReason: availability === "ready"
        ? null
        : "项目记录或当前工作文件暂时无法核对。",
      lastUpdatedAt: null,
    };
  }

  #registeredProjectLastUpdatedAt({ loaded, workingCopyState, rulesInformation }) {
    const candidates = [
      workingCopyState?.lastSavedAt,
      rulesInformation?.mtime instanceof Date
        ? rulesInformation.mtime.toISOString()
        : null,
      ...loaded.manifest.versions.map((version) => version.createdAt),
    ];
    const timestamps = candidates
      .map((value) => Date.parse(String(value || "")))
      .filter((value) => Number.isFinite(value));
    if (timestamps.length === 0) return null;
    return new Date(Math.max(...timestamps)).toISOString();
  }

  async #activeRegisteredWorkingCopy(loaded) {
    const workingCopyIdValue = loaded.runtime.activeWorkingCopyId;
    if (!workingCopyIdValue) {
      throw new ProjectFileRepositoryError(
        "ACTIVE_WORKING_COPY_REQUIRED",
        "The registered project has no active Working Copy to open.",
      );
    }
    const workingCopy = loaded.manifest.workingCopies.find(
      (entry) => entry.workingCopyId === workingCopyIdValue,
    );
    if (!workingCopy) {
      throw new ProjectFileRepositoryError(
        "ACTIVE_WORKING_COPY_UNKNOWN",
        "The registered project active Working Copy is unknown.",
      );
    }
    return workingCopy;
  }

  async #listRegisteredProjects() {
    const registry = await this.#readRegistry();
    const registeredEntries = Object.entries(registry.projects);
    if (registeredEntries.length === 0) return [];
    const rootCensus = await this.#registeredRootCensus();
    const rows = [];
    for (const [projectId, record] of registeredEntries) {
      let row = this.#registeredProjectCatalogFallback(projectId, record, "invalid");
      try {
        const loaded = await this.#loadRegisteredProject({ projectId, readOnly: true, rootCensus });
        const workingCopy = await this.#activeRegisteredWorkingCopy(loaded);
        row = {
          ...row,
          documentId: loaded.project.documentId,
          projectName: path.basename(loaded.paths.projectRootPath),
          registeredProjectRootPath: loaded.paths.projectRootPath,
          activeWorkingCopyId: workingCopy.workingCopyId,
          currentBasedOnVersionId: workingCopy.basedOnVersionId,
          latestOfficialVersionId: loaded.manifest.latestOfficialVersionId,
          hasPendingCandidate: loaded.runtime.activeCandidateId !== null,
          lastUpdatedAt: this.#registeredProjectLastUpdatedAt({ loaded }),
        };
        const active = workingCopy;
        const declaredPath = workingCopySourcePath(loaded.paths, active);
        const binding = await readSourceBinding(loaded.paths.projectRootPath, active.workingCopyId);
        await assertUniqueSourceBinding(loaded.paths.projectRootPath, loaded.manifest.workingCopies, active.workingCopyId, binding);
        const boundPath = await findBoundSource(loaded.paths.projectRootPath, binding);
        const information = await regularInformation(declaredPath, "Working Copy", { projectRootPath: loaded.paths.projectRootPath });
        if (boundPath && information && !samePath(boundPath, declaredPath)) {
          throw new ProjectFileRepositoryError("MANAGED_PATH_AMBIGUOUS", "登记位置与绑定指向不同工作文件，请核对文件。");
        }
        const displayPath = boundPath || (information ? declaredPath : null);
        if (!displayPath) throw new ProjectFileRepositoryError("WORKING_COPY_UNAVAILABLE", "工作文件暂不可用。", { canRestore: Boolean(binding) });
        const state = await readJsonFile(workingCopyStatePath(loaded.paths, active), "Working Copy state", { projectRootPath: loaded.paths.projectRootPath });
        const rulesInformation = await regularInformation(path.join(loaded.paths.projectRootPath, "PROJECT.md"), "PROJECT.md", { projectRootPath: loaded.paths.projectRootPath });
        Object.assign(row, {
          activeWorkingCopyId: active.workingCopyId,
          currentBasedOnVersionId: active.basedOnVersionId,
          latestOfficialVersionId: loaded.manifest.latestOfficialVersionId,
          activeSourcePath: displayPath,
          availability: "ready",
          sourceStatus: "unknown",
          availabilityReason: "文件内容尚未核对，打开时检查。",
          lastUpdatedAt: this.#registeredProjectLastUpdatedAt({ loaded, workingCopyState: state, rulesInformation }),
        });
      } catch (cause) {
        if (cause?.code === "REGISTERED_PROJECT_UNAVAILABLE" && cause.details?.confirmedAbsent === true) continue;
        row.availability = registeredProjectCatalogAvailability(cause);
        row.availabilityReason = cause?.message || row.availabilityReason;
        row.sourceStatus = ["MANAGED_PATH_AMBIGUOUS", "REGISTERED_PROJECT_AMBIGUOUS"].includes(cause?.code)
          ? "duplicate" : ["WORKING_COPY_UNAVAILABLE", "SOURCE_NOT_FOUND"].includes(cause?.code)
            ? "missing" : "invalid";
        row.canRestoreWorkingCopy = cause?.details?.canRestore === true;
      }
      rows.push(row);
    }
    return rows.sort((left, right) => left.projectName.localeCompare(right.projectName, "zh-CN") || left.projectId.localeCompare(right.projectId));
  }

  async #listRegisteredProjectVersionSummaries({ projectId }) {
    const id = assertId(projectId, PROJECT_ID, "projectId");
    const loaded = await this.#loadRegisteredProject({ projectId: id, readOnly: true });
    const activeWorkingCopy = await this.#activeRegisteredWorkingCopy(loaded);
    let activeDisplayPath = workingCopySourcePath(loaded.paths, activeWorkingCopy);
    try {
      if (!await regularInformation(activeDisplayPath, "Working Copy", { projectRootPath: loaded.paths.projectRootPath })) {
        const binding = await readSourceBinding(loaded.paths.projectRootPath, activeWorkingCopy.workingCopyId);
        activeDisplayPath = await findBoundSource(loaded.paths.projectRootPath, binding) || activeDisplayPath;
      }
    } catch { /* Locator display failure never gates immutable Version metadata. */ }
    const versions = loaded.manifest.versions.map((version) => {
      const workingCopy = loaded.manifest.workingCopies.find(
        (entry) => entry.versionId === version.versionId,
      );
      const isActiveWorkingCopy = workingCopy?.workingCopyId === activeWorkingCopy.workingCopyId;
      const displayFileName = projectVersionDisplayFileName({
        version, currentSourcePath: activeDisplayPath,
        versionSourcePath: isActiveWorkingCopy ? activeDisplayPath : workingCopy?.sourceRelativePath,
      });
      return {
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        versionId: version.versionId,
        ordinal: version.ordinal,
        basedOnVersionId: version.basedOnVersionId || null,
        previousVersionId: version.previousVersionId || null,
        displayFileName,
        modifiedAt: String(version.createdAt),
        isActiveWorkingCopy,
        isLatestOfficial: version.versionId === loaded.manifest.latestOfficialVersionId,
      };
    });
    return {
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      currentBasedOnVersionId: activeWorkingCopy.basedOnVersionId,
      latestVersionId: loaded.manifest.latestOfficialVersionId,
      versions,
    };
  }

  async #resolveRegisteredProjectOpenTarget({ projectId, workingCopyId: requestedWorkingCopyId = null }) {
    const id = assertId(projectId, PROJECT_ID, "projectId");
    const initial = await this.#loadRegisteredProject({ projectId: id });
    await this.#recoverProject(initial.paths.projectRootPath);
    const loaded = await this.#ensureCurrentDraft(await this.#loadRegisteredProject({ projectId: id }));
    const requestedId = requestedWorkingCopyId === null ? null : assertId(requestedWorkingCopyId, WORKING_COPY_ID, "workingCopyId");
    const workingCopy = requestedId
      ? loaded.manifest.workingCopies.find((member) => member.workingCopyId === requestedId)
      : await this.#activeRegisteredWorkingCopy(loaded);
    if (!workingCopy) throw new ProjectFileRepositoryError("WORKING_COPY_UNAVAILABLE", "登记中没有这个工作副本。");
    // Resolve the exact Working Copy and bytes once after safe Finder-rename
    // recovery; the OpenTarget and source travel as one immutable envelope.
    const resolved = await this.#resolveMutationTarget({
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      projectRootPath: loaded.paths.projectRootPath,
      workingCopyId: workingCopy.workingCopyId,
    });
    // Desktop validates this exact identity tuple without re-reading HTML.
    const version = resolved.manifest.versions.find(
      (entry) => entry.versionId === resolved.workingCopy.versionId,
    );
    if (!version) {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_VERSION_UNKNOWN",
        "The active Working Copy references an unknown Version.",
      );
    }
    return {
      target: publicOpenTarget({
        project: resolved.project,
        projectRootPath: resolved.paths.projectRootPath,
        targetKind: "working-copy",
        workingCopy: resolved.workingCopy,
        version,
        exactSourcePath: resolved.exactSourcePath,
        sourceSha256: resolved.source.sha256,
      }),
      sourceSha256: resolved.source.sha256,
      html: resolved.source.html,
      lastModifiedAt: resolved.source.lastModifiedAt,
      historyCreation: resolved.runtime.historyCreation
        ? Object.freeze({ ...resolved.runtime.historyCreation })
        : null,
    };
  }

  async #reconcileWorkingCopyLocator({
    operationId,
    previousSourcePath,
    projectId,
    documentId,
    workingCopyId,
    versionId,
    expectedSourceSha256,
    reason,
  }) {
    const requestedOperationId = String(operationId || "");
    if (!SAFE_OPERATION_ID.test(requestedOperationId)) {
      throw new ProjectFileRepositoryError(
        "INVALID_OPERATION_ID",
        "operationId is invalid.",
      );
    }
    const requestedReason = String(reason || "");
    if (!RECONCILE_LOCATOR_REASONS.has(requestedReason)) {
      throw new ProjectFileRepositoryError(
        "INVALID_RECONCILE_REASON",
        "The locator reconcile reason is not allowed.",
      );
    }
    const previousPath = normalizedPath(previousSourcePath);
    htmlExtension(previousPath);
    const expectedHash = assertSha256(expectedSourceSha256, "expectedSourceSha256");
    const requestedWorkingCopyId = assertId(
      workingCopyId,
      WORKING_COPY_ID,
      "workingCopyId",
    );
    const requestedVersionId = assertId(versionId, VERSION_ID, "versionId");
    const loaded = await this.#loadRegisteredProject({
      projectId,
      documentId,
    });
    const workingCopy = loaded.manifest.workingCopies.find(
      (entry) => entry.workingCopyId === requestedWorkingCopyId,
    );
    if (!workingCopy) {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_UNAVAILABLE",
        "The Working Copy HTML is temporarily unavailable; Stemmio did not write outside its registered path.",
        { workingCopyId: requestedWorkingCopyId },
      );
    }
    if (workingCopy.versionId !== requestedVersionId) {
      throw new ProjectFileRepositoryError(
        "MANAGED_SOURCE_IDENTITY_MISMATCH",
        "The supplied Working Copy identity does not match the registered source.",
        { workingCopyId: requestedWorkingCopyId },
      );
    }

    const { exactSourcePath, source } = await this.#resolveWorkingCopyPath(loaded, workingCopy);
    const pathChanged = !samePath(exactSourcePath, previousPath);
    const contentChanged = source.sha256 !== expectedHash;
    const status = contentChanged
      ? "content-changed"
      : pathChanged
        ? "relocated"
        : "unchanged";
    const version = loaded.manifest.versions.find(
      (entry) => entry.versionId === workingCopy.versionId,
    );
    return {
      operationId: requestedOperationId,
      status,
      reason: requestedReason,
      previousSourcePath: previousPath,
      sourcePath: exactSourcePath,
      sourceSha256: source.sha256,
      openTarget: publicOpenTarget({
        project: loaded.project,
        projectRootPath: loaded.paths.projectRootPath,
        targetKind: "working-copy",
        workingCopy,
        version,
        exactSourcePath,
        sourceSha256: source.sha256,
      }),
    };
  }

  async #resolveOpenTarget({ sourcePath, readOnly = false }) {
    const exactSourcePath = normalizedPath(sourcePath);
    htmlExtension(exactSourcePath);
    const loaded = await this.#registeredProjectForSource(exactSourcePath, { readOnly });
    if (!loaded) return null;
    const source = await readHtmlFile(exactSourcePath, "HTML", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    const target = await this.#targetForExactPath(loaded, exactSourcePath, source, { readOnly });
    // An unlisted user HTML inside a project root is still an external file:
    // Stemmio must never infer a Working Copy merely from its location.
    return target;
  }

  async #rebindWorkingCopyPath(loaded, workingCopy, exactSourcePath, information, { persistLocator = true } = {}) {
    const relative = path.relative(loaded.paths.projectRootPath, exactSourcePath)
      .split(path.sep)
      .join("/");
    const sourceRelativePath = topLevelHtmlRelativePath(relative, "sourceRelativePath");
    const naming = preferredNamingForWorkingCopyPath(
      sourceRelativePath,
      versionOrdinalFor(
        loaded.manifest,
        workingCopy.versionId,
        "Working Copy versionId",
      ),
    );
    const changed = (
      workingCopy.sourceRelativePath !== sourceRelativePath
      || workingCopy.preferredFileStem !== naming.preferredFileStem
      || workingCopy.preferredExtension !== naming.preferredExtension
      || JSON.stringify(workingCopy.fileIdentity) !== JSON.stringify(copyFileIdentity(information))
    );
    if (!changed) return false;
    workingCopy.sourceRelativePath = sourceRelativePath;
    workingCopy.preferredFileStem = naming.preferredFileStem;
    workingCopy.preferredExtension = naming.preferredExtension;
    workingCopy.fileIdentity = copyFileIdentity(information);
    if (persistLocator) await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      loaded.paths.manifestPath,
      loaded.manifest,
      "manifest.json",
    );
    return true;
  }

  async #resolveWorkingCopyPath(loaded, workingCopy, label = "Working Copy", { persistLocator = true, bindingIndex = null, expectedInformation = null, readOnly = false } = {}) {
    const projectRootPath = loaded.paths.projectRootPath;
    const state = await readJsonFile(workingCopyStatePath(loaded.paths, workingCopy), "Working Copy state", { projectRootPath });
    if (!state) throw new ProjectFileRepositoryError("WORKING_COPY_STATE_NOT_FOUND", "Working Copy state is missing.");
    assertWorkingCopyState(state, loaded, workingCopy, { allowMissingIdentityBinding: true });
    const mappedPath = workingCopySourcePath(loaded.paths, workingCopy);
    const mapped = await regularInformation(mappedPath, label, { projectRootPath });
    const binding = await readSourceBinding(projectRootPath, workingCopy.workingCopyId);
    await assertUniqueSourceBinding(projectRootPath, loaded.manifest.workingCopies, workingCopy.workingCopyId, binding, bindingIndex);
    const boundPath = await findBoundSource(projectRootPath, binding, bindingIndex);
    if (mapped && boundPath && !samePath(mappedPath, boundPath)) {
      throw new ProjectFileRepositoryError("MANAGED_PATH_AMBIGUOUS", "登记位置与绑定指向不同工作文件，请处理重复副本。");
    }
    const exactSourcePath = mapped ? mappedPath : boundPath;
    if (!exactSourcePath) {
      throw new ProjectFileRepositoryError("WORKING_COPY_UNAVAILABLE", binding
        ? "工作文件缺失，绑定中仍有可核对的文件；可恢复工作文件。"
        : "工作文件缺失，请将原文件放回项目文件夹的登记位置。",
      { workingCopyId: workingCopy.workingCopyId, canRestore: Boolean(binding) });
    }
    const source = await readHtmlFile(exactSourcePath, label, { projectRootPath });
    const selectedBindingInformation = expectedInformation || (!mapped ? binding?.information : null);
    if (selectedBindingInformation && !sameFileIdentity(
      copyFileIdentity(selectedBindingInformation), copyFileIdentity(source.information),
    )) {
      throw new ProjectFileRepositoryError("WORKING_COPY_CONFLICT", "改名工作文件在绑定核对后被替换，未更新登记路径。");
    }
    const sourceStatus = source.sha256 === state.currentSha256 ? "ready" : "external-change";
    // A registered path or a unique live binding selects the member. A hash
    // validates that selection; it never searches for/claims an unlisted file.
    if (sourceStatus === "ready" && !readOnly) {
      await refreshSourceBinding(projectRootPath, workingCopy.workingCopyId, exactSourcePath, state.currentSha256, { bindingIndex, expectedInformation: selectedBindingInformation });
    }
    const locatorChanged = await this.#rebindWorkingCopyPath(loaded, workingCopy, exactSourcePath, source.information, { persistLocator });
    return { exactSourcePath, sourceInformation: source.information, source, sourceStatus, locatorChanged };
  }

  async #resolveWorkingCopySource(loaded, workingCopy, label = "Working Copy") {
    return this.#resolveWorkingCopyPath(loaded, workingCopy, label);
  }

  async #targetForExactPath(loaded, exactSourcePath, source, { readOnly = false } = {}) {
    const { paths, project, manifest } = loaded;
    for (const version of manifest.versions) {
      const snapshotPath = versionSnapshotPath(paths, version);
      if (samePath(snapshotPath, exactSourcePath)) {
        if (source.sha256 !== version.contentSha256) {
          throw new ProjectFileRepositoryError(
            "VERSION_SNAPSHOT_HASH_MISMATCH",
            "The immutable Version snapshot changed and cannot be opened.",
          );
        }
        return publicOpenTarget({
          project,
          projectRootPath: paths.projectRootPath,
          targetKind: "version",
          version,
          exactSourcePath,
          sourceSha256: source.sha256,
        });
      }
    }
    const direct = manifest.workingCopies.find((workingCopy) => (
      samePath(workingCopySourcePath(paths, workingCopy), exactSourcePath)
    ));
    if (direct) {
      await this.#resolveWorkingCopyPath(loaded, direct, "Working Copy", { readOnly, persistLocator: !readOnly });
      return publicOpenTarget({
        project,
        projectRootPath: paths.projectRootPath,
        targetKind: "working-copy",
        workingCopy: direct,
        version: manifest.versions.find((version) => version.versionId === direct.versionId),
        exactSourcePath,
        sourceSha256: source.sha256,
      });
    }
    // A Finder rename is a controlled recovery only when the registered
    // manifest mapping is actually absent.  A second hard link, copied file,
    // same name or same bytes never becomes managed while the recorded member
    // remains present.  The Registry, v4 IDs, missing registered mapping and
    // one surviving file-identity clue are all required before rebinding.
    const matching = [];
    for (const workingCopy of manifest.workingCopies) {
      const mappedPath = workingCopySourcePath(paths, workingCopy);
      const mappedInformation = await regularInformation(mappedPath, "Working Copy", {
        projectRootPath: paths.projectRootPath,
      });
      if (mappedInformation) continue;
      const binding = await readSourceBinding(paths.projectRootPath, workingCopy.workingCopyId);
      const boundPath = await findBoundSource(paths.projectRootPath, binding);
      if (boundPath && samePath(boundPath, exactSourcePath)) {
        matching.push(workingCopy);
      }
    }
    if (matching.length > 1) {
      throw new ProjectFileRepositoryError(
        "MANAGED_PATH_AMBIGUOUS",
        "More than one Working Copy has the same filesystem identity.",
        {
          projectId: project.projectId,
          workingCopyIds: matching.map((entry) => entry.workingCopyId),
        },
      );
    }
    const workingCopy = matching[0] || null;
    if (!workingCopy) return null;
    await this.#resolveWorkingCopyPath(loaded, workingCopy, "Working Copy", { readOnly, persistLocator: !readOnly });
    return publicOpenTarget({
      project,
      projectRootPath: paths.projectRootPath,
      targetKind: "working-copy",
      workingCopy,
      version: manifest.versions.find((version) => version.versionId === workingCopy.versionId),
      exactSourcePath,
      sourceSha256: source.sha256,
    });
  }

  async #resolveMutationTarget(target) {
    if (!isObject(target)) {
      throw new ProjectFileRepositoryError("OPEN_TARGET_REQUIRED", "A managed OpenTarget is required.");
    }
    const projectId = assertId(target.projectId, PROJECT_ID, "projectId");
    const documentId = assertId(target.documentId, DOCUMENT_ID, "documentId");
    const workingCopyIdValue = assertId(target.workingCopyId, WORKING_COPY_ID, "workingCopyId");
    const declaredProjectRootPath = normalizedPath(target.projectRootPath);
    const loaded = await this.#loadRegisteredProject({
      projectId,
      documentId,
      declaredProjectRootPath,
    });
    const workingCopy = loaded.manifest.workingCopies.find(
      (entry) => entry.workingCopyId === workingCopyIdValue,
    );
    if (!workingCopy) {
      throw new ProjectFileRepositoryError("WORKING_COPY_NOT_FOUND", "The active Working Copy no longer exists.");
    }
    if (workingCopy.workingCopyId !== loaded.runtime.activeWorkingCopyId) {
      throw new ProjectFileRepositoryError("WORKING_COPY_NOT_CURRENT", "Only the current draft is editable; historical versions are immutable.");
    }
    const source = await this.#resolveWorkingCopySource(loaded, workingCopy);
    return { ...loaded, workingCopy, ...source };
  }


  async #saveWorkingCopy({
    target,
    html,
    expectedSourceSha256,
    editRevision,
    sourceHistoryOperations,
  }) {
    const loaded = await this.#resolveMutationTarget(target);
    const expected = assertSha256(expectedSourceSha256, "expectedSourceSha256");
    let nextHtml = String(html || "");
    requireCompleteHtml(nextHtml, "Working Copy HTML");
    const revision = Number.isSafeInteger(Number(editRevision)) && Number(editRevision) >= 0
      ? Number(editRevision)
      : 0;
    const statePath = workingCopyStatePath(loaded.paths, loaded.workingCopy);
    const currentState = await readJsonFile(statePath, "Working Copy state", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (!currentState) {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_STATE_NOT_FOUND",
        "The Working Copy state is missing; Stemmio did not modify its HTML.",
      );
    }
    assertWorkingCopyState(currentState, loaded, loaded.workingCopy);
    if (
      currentState.sourceElementIdentitySchemaVersion
        === STEMMIO_ELEMENT_ID_SCHEMA_VERSION
    ) {
      nextHtml = materializeIdentityPreservingSave(
        loaded.source.html,
        nextHtml,
        { sourceHistoryOperations },
      ).html;
    }
    const nextBuffer = Buffer.from(nextHtml, "utf8");
    const nextSha256 = sha256(nextBuffer);
    const recoveryId = `save_${loaded.workingCopy.workingCopyId}_${revision || "current"}_${randomUUID().replaceAll("-", "")}`;
    const recoveryPaths = saveRecoveryPaths(
      loaded.paths,
      loaded.workingCopy.workingCopyId,
      revision,
      recoveryId,
    );
    await ensureProjectDirectory(
      loaded.paths.projectRootPath,
      recoveryPaths.operationRoot,
      "save recovery directory",
    );
    const transactionPath = path.join(
      loaded.paths.transactionsRoot,
      `${recoveryId}.json`,
    );
    let transaction = {
      schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      kind: "save",
      state: "prepared",
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      workingCopyId: loaded.workingCopy.workingCopyId,
      sourceRelativePath: loaded.workingCopy.sourceRelativePath,
      expectedSourceSha256: expected,
      targetSourceSha256: nextSha256,
      editRevision: revision,
      recoveryId,
      preparedAt: nowIso(this.#clock),
    };
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      transactionPath,
      transaction,
      "save transaction",
    );
    await atomicWriteProjectFile(
      loaded.paths.projectRootPath,
      recoveryPaths.nextPath,
      nextBuffer,
      "save replacement bytes",
    );
    await this.#hit("save-prepared", { transactionPath });

    let cas = await compareAndSwapWorkingCopyFile({
      sourcePath: loaded.exactSourcePath,
      nextBuffer,
      expectedSha256: expected,
      nextSha256,
      projectRootPath: loaded.paths.projectRootPath,
      expectedInformation: loaded.source.information,
      previousPath: recoveryPaths.previousPath,
      preparedBindingPath: path.join(recoveryPaths.operationRoot, "next-binding.ref"),
      beforePublication: () => this.#hit("save-before-publication", { transactionPath }),
      afterDisplacement: () => this.#hit("save-source-displaced", { transactionPath }),
      beforeCommit: async () => {
        await this.#hit("save-before-commit", { transactionPath });
        const current = await this.#loadRegisteredProject({ projectId: loaded.project.projectId, documentId: loaded.project.documentId });
        const member = current.manifest.workingCopies.find((entry) => entry.workingCopyId === loaded.workingCopy.workingCopyId);
        if (!member || !samePath(workingCopySourcePath(current.paths, member), loaded.exactSourcePath)) {
          throw new ProjectFileRepositoryError("WORKING_COPY_CONFLICT", "工作文件登记在保存过程中发生变化。");
        }
        await this.#resolveWorkingCopyPath(current, member);
      },
    });
    if (!cas.swapped && cas.actualSha256 === nextSha256) {
      const disk = await readHtmlFile(loaded.exactSourcePath, "Working Copy", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      cas = {
        swapped: true,
        replayed: true,
        actualSha256: disk.sha256,
        written: disk,
      };
    }
    if (!cas.swapped) {
      await this.#finalizeSaveTransaction(
        loaded.paths.projectRootPath,
        transactionPath,
        transaction,
        {
          state: "committed",
          recovery: nextSha256 === expected
            ? "adopted-external"
            : "source-changed-before-cas",
        },
      );
      await rm(recoveryPaths.operationRoot, { recursive: true, force: true }).catch(() => {});
      if (nextSha256 === expected && cas.actualSha256) {
        const disk = await readHtmlFile(loaded.exactSourcePath, "Working Copy", {
          projectRootPath: loaded.paths.projectRootPath,
        });
        const adopted = await this.#reconcileExternalWorkingCopyState({
          loaded,
          workingCopy: loaded.workingCopy,
          state: currentState,
          source: disk,
        });
        return this.#savedWorkingCopyResult({
          loaded,
          sourcePath: loaded.exactSourcePath,
          sourceSha256: disk.sha256,
          lastPersistedRevision: Number(adopted.state.lastPersistedRevision || 0),
        });
      }
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_CONFLICT",
        "The Working Copy changed on disk while Stemmio still retains unsaved edits.",
        {
          expectedSourceSha256: expected,
          actualSourceSha256: cas.actualSha256,
          targetSourceSha256: nextSha256,
          saveState: currentState.saveState || null,
        },
      );
    }

    await this.#hit("save-source-written", { transactionPath });
    await refreshSourceBinding(loaded.paths.projectRootPath, loaded.workingCopy.workingCopyId,
      loaded.exactSourcePath, nextSha256);
    await this.#hit("save-anchor-switched", { transactionPath });
    loaded.workingCopy.fileIdentity = copyFileIdentity(cas.written.information);
    const nextState = {
      ...currentState,
      schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
      projectId: loaded.project.projectId,
      documentId: loaded.project.documentId,
      workingCopyId: loaded.workingCopy.workingCopyId,
      currentSha256: nextSha256,
      differsFromBase: nextSha256 !== currentState.baseSha256,
      saveState: "saved",
      lastPersistedRevision: Math.max(
        Number(currentState.lastPersistedRevision || 0),
        revision,
      ),
      lastSavedAt: nowIso(this.#clock),
      ...(currentState.sourceElementIdentitySchemaVersion
        === STEMMIO_ELEMENT_ID_SCHEMA_VERSION
        ? {
            sourceElementIdentityBindingSha256:
              sourceElementIdentityBindingSha256(nextHtml),
          }
        : {}),
    };
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      statePath,
      nextState,
      "Working Copy state",
    );
    await this.#hit("save-state-written", { transactionPath });
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      loaded.paths.manifestPath,
      loaded.manifest,
      "manifest.json",
    );
    await this.#hit("save-manifest-written", { transactionPath });
    await this.#writeRuntime(loaded);
    const committedSource = await readHtmlFile(loaded.exactSourcePath, "Working Copy", { projectRootPath: loaded.paths.projectRootPath });
    const previous = cas.replayed ? null : await readHtmlFile(recoveryPaths.previousPath, "previous Working Copy", { projectRootPath: loaded.paths.projectRootPath });
    if (committedSource.sha256 !== nextSha256 || (previous && previous.sha256 !== expected)) {
      throw new ProjectFileRepositoryError("SAVE_RECOVERY_CONFLICT", "保存期间发生外部修改，两份内容已保留供核对。");
    }
    await this.#finalizeSaveTransaction(
      loaded.paths.projectRootPath,
      transactionPath,
      transaction,
      { state: "committed" },
    );
    await this.#hit("save-committed", { transactionPath });
    if (previous) {
      const retained = await readHtmlFile(recoveryPaths.previousPath, "previous Working Copy", { projectRootPath: loaded.paths.projectRootPath });
      if (retained.sha256 !== expected) throw new ProjectFileRepositoryError("SAVE_RECOVERY_CONFLICT", "外部修改的旧工作文件已保留供恢复。");
    }
    await this.#retireCommittedSave(loaded, transactionPath, {
      ...transaction, state: "committed",
    });
    return this.#savedWorkingCopyResult({
      loaded,
      sourcePath: loaded.exactSourcePath,
      sourceSha256: nextSha256,
      lastPersistedRevision: nextState.lastPersistedRevision,
    });
  }

  async #retireCommittedSave(loaded, transactionPath, transaction) {
    if (transaction?.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || transaction.kind !== "save" || transaction.state !== "committed"
      || transaction.recovery || !transaction.recoveryId
      || transaction.projectId !== loaded.project.projectId
      || transaction.documentId !== loaded.project.documentId
      || !SHA256.test(transaction.expectedSourceSha256)
      || !SHA256.test(transaction.targetSourceSha256)
      || !Number.isSafeInteger(transaction.editRevision) || transaction.editRevision < 0) return "retained";
    const workingCopy = loaded.manifest.workingCopies.find(
      (entry) => entry.workingCopyId === transaction.workingCopyId,
    );
    if (!workingCopy || workingCopy.sourceRelativePath !== transaction.sourceRelativePath) return "retained";
    const recovery = saveRecoveryPaths(loaded.paths, workingCopy.workingCopyId,
      transaction.editRevision, transaction.recoveryId);
    if (transactionPath !== path.join(loaded.paths.transactionsRoot, `${transaction.recoveryId}.json`)) return "retained";
    const sourcePath = workingCopySourcePath(loaded.paths, workingCopy);
    const statePath = workingCopyStatePath(loaded.paths, workingCopy);
    const verify = async () => {
      const project = await readJsonFile(loaded.paths.projectPath, "project.json", { projectRootPath: loaded.paths.projectRootPath });
      assertProjectIdentity(project);
      const manifest = await readJsonFile(loaded.paths.manifestPath, "manifest.json", { projectRootPath: loaded.paths.projectRootPath });
      assertManifest(manifest, project);
      if (project.projectId !== transaction.projectId || project.documentId !== transaction.documentId
        || !manifest.workingCopies.some((entry) => entry.workingCopyId === workingCopy.workingCopyId
          && entry.sourceRelativePath === workingCopy.sourceRelativePath)) {
        throw new ProjectFileRepositoryError("SAVE_TRANSACTION_IDENTITY_MISMATCH", "The Working Copy identity changed before retirement.");
      }
      const current = await readJsonFile(transactionPath, "save transaction", { projectRootPath: loaded.paths.projectRootPath });
      if (!current || current.state !== "committed" || current.recovery
        || Object.keys(transaction).some((key) => key !== "state" && current[key] !== transaction[key])) {
        throw new ProjectFileRepositoryError("SAVE_TRANSACTION_INVALID", "The save journal changed before retirement.");
      }
      const state = await readJsonFile(statePath, "Working Copy state", { projectRootPath: loaded.paths.projectRootPath });
      assertWorkingCopyState(state, loaded, workingCopy);
      const source = await readHtmlFile(sourcePath, "Working Copy", { projectRootPath: loaded.paths.projectRootPath });
      const previous = await readRegularFileWithSha256(recovery.previousPath, "previous Working Copy", { projectRootPath: loaded.paths.projectRootPath });
      if (source.sha256 !== transaction.targetSourceSha256 || state.currentSha256 !== source.sha256
        || state.saveState !== "saved" || Number(state.lastPersistedRevision) < transaction.editRevision
        || (previous && previous.sha256 !== transaction.expectedSourceSha256)) {
        throw new ProjectFileRepositoryError("SAVE_RECOVERY_CONFLICT", "保存后的源或旧工作文件发生变化，恢复记录已保留。");
      }
    };
    return retireSaveTransaction({
      projectRootPath: loaded.paths.projectRootPath,
      transactionPath, recoveryPath: recovery.operationRoot,
      publicationFiles: [sourcePath, statePath, loaded.paths.manifestPath, loaded.paths.runtimePath, transactionPath],
      publicationDirectories: [loaded.paths.projectRootPath, loaded.paths.controlRoot,
        path.dirname(statePath), path.join(loaded.paths.controlRoot, "source-bindings"),
        loaded.paths.transactionsRoot],
      verify,
    });
  }

  async #retireCommittedSaveStock(loaded, candidates) {
    const stateByWorkingCopyId = new Map();
    let attempts = 0;
    for (const { transactionPath, transaction } of candidates) {
      if (attempts >= SAVE_RETIREMENT_ATTEMPT_LIMIT) break;
      if (transaction?.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
        || transaction.kind !== "save" || transaction.state !== "committed"
        || transaction.recovery || !transaction.recoveryId
        || transaction.projectId !== loaded.project.projectId
        || transaction.documentId !== loaded.project.documentId
        || !SHA256.test(transaction.expectedSourceSha256)
        || !SHA256.test(transaction.targetSourceSha256)
        || !Number.isSafeInteger(transaction.editRevision) || transaction.editRevision < 0) continue;
      const workingCopy = loaded.manifest.workingCopies.find(
        (entry) => entry.workingCopyId === transaction.workingCopyId,
      );
      if (!workingCopy || workingCopy.sourceRelativePath !== transaction.sourceRelativePath) continue;
      if (transactionPath !== path.join(
        loaded.paths.transactionsRoot,
        `${transaction.recoveryId}.json`,
      )) continue;

      let state = stateByWorkingCopyId.get(workingCopy.workingCopyId);
      if (state === undefined) {
        try {
          state = await readJsonFile(
            workingCopyStatePath(loaded.paths, workingCopy),
            "Working Copy state",
            { projectRootPath: loaded.paths.projectRootPath },
          );
          assertWorkingCopyState(state, loaded, workingCopy);
        } catch {
          state = null;
        }
        stateByWorkingCopyId.set(workingCopy.workingCopyId, state);
      }
      if (!state
        || state.currentSha256 !== transaction.targetSourceSha256
        || state.saveState !== "saved"
        || Number(state.lastPersistedRevision) < transaction.editRevision) continue;

      attempts += 1;
      try {
        await this.#retireCommittedSave(loaded, transactionPath, transaction);
      } catch {
        // Optional stock cleanup never turns project recovery into failure.
      }
    }
  }

  async #finalizeSaveTransaction(projectRootPath, transactionPath, transaction, extra) {
    const current = await readJsonFile(transactionPath, "save transaction", {
      projectRootPath,
    });
    await atomicWriteProjectJson(
      projectRootPath,
      transactionPath,
      {
        ...(current || transaction),
        ...extra,
        committedAt: nowIso(this.#clock),
      },
      "save transaction",
    );
  }

  #savedWorkingCopyResult({ loaded, sourcePath, sourceSha256, lastPersistedRevision }) {
    return {
      target: publicOpenTarget({
        project: loaded.project,
        projectRootPath: loaded.paths.projectRootPath,
        targetKind: "working-copy",
        workingCopy: loaded.workingCopy,
        version: loaded.manifest.versions.find(
          (version) => version.versionId === loaded.workingCopy.versionId,
        ),
        exactSourcePath: sourcePath,
        sourceSha256,
      }),
      lastPersistedRevision,
      currentSha256: sourceSha256,
      versionCreated: false,
    };
  }

  async #createCandidate({
    target,
    requestId,
    attemptId,
    candidateId,
    html,
    expectedSourceSha256,
    candidateIdentity = null,
    assessmentBaseHtml = null,
    allowSourceDivergence = false,
    requestedTargetElementIds = [],
    requestedTargetCount = null,
    requestedTargetIsPage = false,
    inputManifestSha256 = null,
  }) {
    const loaded = await this.#resolveMutationTarget(target);
    const request = String(requestId || "");
    if (!SAFE_REQUEST_ID.test(request)) {
      throw new ProjectFileRepositoryError("INVALID_REQUEST_ID", "requestId is invalid.");
    }
    const expected = assertSha256(expectedSourceSha256, "expectedSourceSha256");
    const manifestAnchor = inputManifestSha256 === null
      ? null
      : assertSha256(inputManifestSha256, "inputManifestSha256");
    if (!allowSourceDivergence && loaded.source.sha256 !== expected) {
      throw new ProjectFileRepositoryError(
        "SOURCE_HASH_CONFLICT",
        "The Working Copy changed before Candidate preparation.",
      );
    }
    const submittedCandidateHtml = String(html || "");
    requireCompleteHtml(submittedCandidateHtml, "Candidate HTML");
    const submittedOutputSha256 = sha256(Buffer.from(submittedCandidateHtml, "utf8"));
    const latest = loaded.manifest.versions.find(
      (version) => version.versionId === loaded.manifest.latestOfficialVersionId,
    );
    const planned = candidateIdentity && isObject(candidateIdentity)
      ? {
          proposedVersionId: assertId(
            candidateIdentity.proposedVersionId,
            VERSION_ID,
            "proposedVersionId",
          ),
          proposedVersionOrdinal: Number(candidateIdentity.proposedVersionOrdinal),
          basedOnVersionId: assertId(
            candidateIdentity.basedOnVersionId,
            VERSION_ID,
            "basedOnVersionId",
          ),
          previousVersionId: assertId(
            candidateIdentity.previousVersionId,
            VERSION_ID,
            "previousVersionId",
          ),
        }
      : {
          proposedVersionId: versionId(latest.ordinal + 1),
          proposedVersionOrdinal: latest.ordinal + 1,
          basedOnVersionId: loaded.workingCopy.basedOnVersionId,
          previousVersionId: latest.versionId,
        };
    if (
      !Number.isSafeInteger(planned.proposedVersionOrdinal)
      || planned.proposedVersionOrdinal < 2
      || planned.proposedVersionId !== versionId(planned.proposedVersionOrdinal)
    ) {
      throw new ProjectFileRepositoryError("INVALID_CANDIDATE", "Candidate Version identity is invalid.");
    }
    const id = candidateId ? candidateId : randomId("candidate");
    assertCandidateId(id);
    const requestRoot = requestRootPath(loaded.paths, request);
    await ensureProjectDirectory(
      loaded.paths.projectRootPath,
      requestRoot,
      "Candidate request directory",
    );
    const outputPath = path.join(requestRoot, "candidate.html");
    const candidatePath = path.join(requestRoot, "candidate.json");
    const existingCandidateRecord = await readJsonFileWithSha256(candidatePath, "candidate.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    const existingCandidate = existingCandidateRecord?.value || null;
    let candidateRecordSha256;
    let outputSha256;
    if (existingCandidate) {
      if (
        existingCandidate.candidateId !== id
        || (
          existingCandidate.submittedOutputSha256
          ?? existingCandidate.outputSha256
        ) !== submittedOutputSha256
      ) {
        throw new ProjectFileRepositoryError(
          "CANDIDATE_COLLISION",
          "This Request already owns another Candidate.",
        );
      }
      const existingOutput = await readHtmlFile(outputPath, "Candidate HTML", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      const active = loaded.runtime.activeRequest;
      if (
        active?.requestId !== request
        || active?.attemptId !== String(attemptId || "attempt_001")
        || active.status !== "pending-review"
        || active.candidateId !== id
        || active.inputManifestSha256 !== manifestAnchor
        || active.candidateOutputSha256 !== existingOutput.sha256
        || active.candidateRecordSha256 !== existingCandidateRecord.sha256
      ) {
        throw new ProjectFileRepositoryError(
          "CANDIDATE_AUTHORITY_MISMATCH",
          "An existing Candidate is not sealed by the active runtime authority.",
        );
      }
      outputSha256 = existingOutput.sha256;
      candidateRecordSha256 = existingCandidateRecord.sha256;
    } else {
      const identityPrepared = prepareCandidateSourceIdentity(
        typeof assessmentBaseHtml === "string"
          ? assessmentBaseHtml
          : loaded.source.html,
        submittedCandidateHtml,
      );
      const candidateHtml = identityPrepared.html;
      const outputBuffer = identityPrepared.buffer;
      outputSha256 = identityPrepared.outputSha256;
      const assessment = assessedCandidate(
        typeof assessmentBaseHtml === "string"
          ? assessmentBaseHtml
          : loaded.source.html,
        candidateHtml,
        this.#clock,
        {
          requestedTargetElementIds,
          requestedTargetCount,
          requestedTargetIsPage,
        },
      );
      await writeFileNoReplace(outputPath, outputBuffer, outputSha256, "Candidate HTML", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      const candidateRecord = {
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        candidateId: id,
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        requestId: request,
        attemptId: String(attemptId || "attempt_001"),
        proposedVersionId: planned.proposedVersionId,
        proposedVersionOrdinal: planned.proposedVersionOrdinal,
        basedOnVersionId: planned.basedOnVersionId,
        previousVersionId: planned.previousVersionId,
        sourceWorkingCopyId: loaded.workingCopy.workingCopyId,
        expectedSourceSha256: expected,
        outputRelativePath: `requests/${request}/candidate.html`,
        submittedOutputSha256,
        outputSha256,
        identityReport: identityPrepared.identityReport,
        assessment,
        status: "pending-review",
        createdAt: nowIso(this.#clock),
      };
      const candidateRecordBuffer = Buffer.from(jsonText(candidateRecord), "utf8");
      candidateRecordSha256 = sha256(candidateRecordBuffer);
      await atomicWriteProjectFile(
        loaded.paths.projectRootPath,
        candidatePath,
        candidateRecordBuffer,
        "candidate.json",
      );
    }
    loaded.runtime.activeRequest = {
      requestId: request,
      candidateId: id,
      attemptId: String(attemptId || "attempt_001"),
      status: "pending-review",
      inputManifestSha256: manifestAnchor,
      candidateOutputSha256: outputSha256,
      candidateRecordSha256,
    };
    loaded.runtime.activeCandidateId = id;
    loaded.runtime.lastAiTask = null;
    await this.#writeRuntime(loaded);
    await this.#hit("candidate-prepared", { requestId: request, candidateId: id });
    return await this.#readCandidateForLoaded(loaded, id);
  }

  async #readCandidateForLoaded(loaded, candidateId, { requireExplicitCandidateId = false } = {}) {
    const requested = requireExplicitCandidateId
      ? candidateId
      : candidateId || loaded.runtime.activeCandidateId;
    if (!requested || !/^candidate_[A-Za-z0-9_-]{8,160}$/u.test(requested)) {
      throw new ProjectFileRepositoryError("CANDIDATE_NOT_FOUND", "No Candidate is awaiting review.");
    }
    const activeRequest = loaded.runtime.activeRequest;
    let candidatePath = activeRequest?.requestId
      ? path.join(loaded.paths.requestsRoot, activeRequest.requestId, "candidate.json")
      : null;
    let candidateRecord = candidatePath
      ? await readJsonFileWithSha256(candidatePath, "candidate.json", {
        projectRootPath: loaded.paths.projectRootPath,
      })
      : null;
    let candidate = candidateRecord?.value || null;
    if (!candidate || candidate.candidateId !== requested) {
      if (activeRequest?.status === "pending-review" && activeRequest.candidateId === requested) {
        throw new ProjectFileRepositoryError(
          "CANDIDATE_AUTHORITY_MISMATCH",
          "The runtime-sealed Candidate record is no longer available.",
        );
      }
      ({ candidatePath, candidate, candidateRecord } = await this.#findCandidateById(loaded, requested));
    }
    if (
      !candidate
      || candidate.candidateId !== requested
      || candidate.projectId !== loaded.project.projectId
      || candidate.documentId !== loaded.project.documentId
    ) {
      throw new ProjectFileRepositoryError("CANDIDATE_NOT_FOUND", "The requested Candidate was not found.");
    }
    assertCandidateAssessment(candidate.assessment);
    const outputPath = resolveRelative(
      loaded.paths.controlRoot,
      candidate.outputRelativePath,
      "candidate output path",
    );
    const output = await readHtmlFile(outputPath, "Candidate HTML", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (output.sha256 !== candidate.outputSha256) {
      throw new ProjectFileRepositoryError(
        "CANDIDATE_HASH_MISMATCH",
        "The Candidate changed after validation and must be reviewed again.",
      );
    }
    if (candidate.status === "pending-review") {
      if (
        activeRequest?.status !== "pending-review"
        || activeRequest.candidateId !== requested
        || activeRequest.candidateOutputSha256 !== output.sha256
        || activeRequest.candidateRecordSha256 !== candidateRecord?.sha256
      ) {
        throw new ProjectFileRepositoryError(
          "CANDIDATE_AUTHORITY_MISMATCH",
          "The Candidate no longer matches the runtime authority sealed for review.",
        );
      }
    }
    if (!candidate.identityReport) {
      throw new ProjectFileRepositoryError(
        "CANDIDATE_IDENTITY_REPORT_INVALID",
        "Candidate source identity evidence is required.",
      );
    }
    assertCandidateIdentityReport(candidate.identityReport);
    if (
      candidate.identityReport.outputSha256 !== candidate.outputSha256
      || candidate.identityReport.submittedOutputSha256
        !== (candidate.submittedOutputSha256 ?? candidate.outputSha256)
    ) {
      throw new ProjectFileRepositoryError(
        "CANDIDATE_IDENTITY_REPORT_INVALID",
        "Candidate source identity evidence does not match its sealed output.",
      );
    }
    assertCandidateSourceIdentityOutput(candidate.identityReport, output.html);
    return {
      candidate,
      candidatePath,
      candidateRecordSha256: candidateRecord?.sha256 || null,
      outputPath,
      output,
    };
  }

  async #findCandidateById(loaded, candidateId) {
    let entries;
    try {
      entries = await listProjectDirectory(
        loaded.paths.projectRootPath,
        loaded.paths.requestsRoot,
        "requests",
      );
    } catch (cause) {
      if (cause?.code === "ENOENT") {
        throw new ProjectFileRepositoryError("CANDIDATE_NOT_FOUND", "The requested Candidate was not found.");
      }
      throw cause;
    }
    const matches = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || !SAFE_REQUEST_ID.test(entry.name)) {
        continue;
      }
      const candidatePath = path.join(loaded.paths.requestsRoot, entry.name, "candidate.json");
      const candidateRecord = await readJsonFileWithSha256(candidatePath, "candidate.json", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      const candidate = candidateRecord?.value || null;
      if (candidate?.candidateId === candidateId) {
        matches.push({ candidatePath, candidate, candidateRecord });
      }
    }
    if (matches.length !== 1) {
      throw new ProjectFileRepositoryError("CANDIDATE_NOT_FOUND", "The requested Candidate was not found.");
    }
    return matches[0];
  }

  async #rejectCandidate({ target, candidateId }) {
    const loaded = await this.#resolveMutationTarget(target);
    const current = await this.#readCandidateForLoaded(loaded, candidateId, {
      requireExplicitCandidateId: true,
    });
    if (current.candidate.status === "promoted") {
      throw new ProjectFileRepositoryError("CANDIDATE_ALREADY_PROMOTED", "The Candidate is already a formal Version.");
    }
    const requestPath = path.join(
      requestRootPath(loaded.paths, current.candidate.requestId),
      "request.json",
    );
    const request = await readJsonFile(requestPath, "request.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (request?.candidateId === current.candidate.candidateId) {
      request.status = "rejected";
      request.rejectedAt = nowIso(this.#clock);
      await this.#writeRequestWithHistory(loaded, requestPath, request);
    }
    // Record the terminal Request decision before releasing the runtime
    // authority. A crash at either boundary then leaves a Candidate that is
    // unavailable for adoption, rather than a mutable record still claiming
    // the old sealed digest.
    loaded.runtime.activeRequest = null;
    loaded.runtime.activeCandidateId = null;
    await this.#writeRuntime(loaded);
    current.candidate.status = "rejected";
    current.candidate.rejectedAt = nowIso(this.#clock);
    await atomicWriteProjectJson(
      loaded.paths.projectRootPath,
      current.candidatePath,
      current.candidate,
      "candidate.json",
    );
    return {
      candidateId: current.candidate.candidateId,
      status: "rejected",
      latestOfficialVersionId: loaded.manifest.latestOfficialVersionId,
    };
  }

  async #allocateVersionWorkingCopy(loaded, {
    preferredFileStem,
    preferredExtension,
    versionOrdinal,
    startAt = 0,
  }) {
    for (let allocationOrdinal = startAt; allocationOrdinal < 10_000; allocationOrdinal += 1) {
      const sourceRelativePath = visibleFileName(
        preferredFileStem,
        versionOrdinal,
        preferredExtension,
        allocationOrdinal,
      );
      const candidatePath = resolveRelative(
        loaded.paths.projectRootPath,
        sourceRelativePath,
        "Version Working Copy path",
      );
      const information = await lstat(candidatePath).catch((cause) => {
        if (cause?.code === "ENOENT") return null;
        throw cause;
      });
      // lstat deliberately treats ordinary files, directories, hard links and
      // symbolic links alike as user-owned collisions.
      if (!information) return { sourceRelativePath, allocationOrdinal };
    }
    throw new ProjectFileRepositoryError(
      "VERSION_PATH_ALLOCATION_EXHAUSTED",
      "Stemmio could not allocate a collision-free Version Working Copy path.",
    );
  }

  async #historyCreationLoaded(target) {
    if (!isObject(target)) throw new ProjectFileRepositoryError("OPEN_TARGET_REQUIRED", "A managed project is required.");
    return this.#loadRegisteredProject({
      projectId: assertId(target.projectId, PROJECT_ID, "projectId"),
      documentId: assertId(target.documentId, DOCUMENT_ID, "documentId"),
      declaredProjectRootPath: normalizedPath(target.projectRootPath),
    });
  }

  #historyCreationPath(loaded, operationId) {
    if (!SAFE_OPERATION_ID.test(String(operationId || ""))) {
      throw new ProjectFileRepositoryError("INVALID_OPERATION_ID", "The history creation operation ID is invalid.");
    }
    return path.join(loaded.paths.transactionsRoot, `history_${operationId}`, "transaction.json");
  }

  #assertHistoryCreation(loaded, transaction, operationId) {
    const source = loaded.manifest.versions.find((v) => v.versionId === transaction?.basedOnVersionId);
    const previous = loaded.manifest.versions.find((v) => v.versionId === transaction?.previousVersionId);
    if (!isObject(transaction) || transaction.kind !== "history-creation"
      || transaction.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || transaction.operationId !== operationId
      || transaction.projectId !== loaded.project.projectId || transaction.documentId !== loaded.project.documentId
      || !["prepared", "working-copy-prepared", "working-copy-created", "manifest-committed", "completed", "aborted"].includes(transaction.state)
      || !source || source.contentSha256 !== transaction.contentSha256
      || !previous || transaction.versionOrdinal !== previous.ordinal + 1
      || transaction.versionId !== versionId(transaction.versionOrdinal)
      || !WORKING_COPY_ID.test(String(transaction.previousWorkingCopyId || ""))
      || !loaded.manifest.workingCopies.some((w) => w.workingCopyId === transaction.previousWorkingCopyId)
      || !SHA256.test(String(transaction.expectedSourceSha256 || ""))
      || !validStateTimestamp(transaction.createdAt)
      || (transaction.openedAt !== null && !validStateTimestamp(transaction.openedAt))
      || !Number.isSafeInteger(transaction.pathAllocationOrdinal) || transaction.pathAllocationOrdinal < 0
      || transaction.finalWorkingCopyRelativePath !== visibleFileName(
        assertPreferredFileStem(transaction.preferredFileStem), transaction.versionOrdinal,
        htmlExtension(`x${transaction.preferredExtension}`), transaction.pathAllocationOrdinal,
      )) {
      throw new ProjectFileRepositoryError("HISTORY_CREATION_INVALID", "The historical creation transaction is inconsistent.");
    }
    if (!["prepared", "aborted"].includes(transaction.state)) assertFileIdentity(transaction.preparedFileIdentity, "Historical creation prepared file");
    return source;
  }

  async #historyCreationResult(loaded, transaction) {
    const version = loaded.manifest.versions.find((v) => v.versionId === transaction.versionId);
    const workingCopy = loaded.manifest.workingCopies.find((w) => w.workingCopyId === workingCopyId(transaction.versionOrdinal));
    if (!version || !workingCopy || version.sourceType !== "history-copy"
      || version.sourceOperationId !== transaction.operationId
      || version.contentSha256 !== transaction.contentSha256
      || version.basedOnVersionId !== transaction.basedOnVersionId
      || version.previousVersionId !== transaction.previousVersionId
      || workingCopy.versionId !== version.versionId) {
      throw new ProjectFileRepositoryError("HISTORY_CREATION_COMMIT_MISMATCH", "The created Version does not match its operation.");
    }
    return { status: "created", operationId: transaction.operationId,
      projectId: loaded.project.projectId, documentId: loaded.project.documentId,
      versionId: version.versionId, versionOrdinal: version.ordinal,
      basedOnVersionId: version.basedOnVersionId, previousVersionId: version.previousVersionId,
      contentSha256: version.contentSha256, workingCopyId: workingCopy.workingCopyId,
      sourcePath: workingCopySourcePath(loaded.paths, workingCopy),
      openedAt: transaction.openedAt,
      recoveryState: loaded.manifest.latestOfficialVersionId !== version.versionId
        || loaded.runtime.activeWorkingCopyId !== workingCopy.workingCopyId
        ? "superseded" : transaction.openedAt ? "opened" : "pending" };
  }

  async #createVersionFromHistory({ target, versionId: requestedVersionId, operationId, expectedSourceSha256, expectedSnapshotSha256 }) {
    let loaded = await this.#historyCreationLoaded(target);
    const transactionPath = this.#historyCreationPath(loaded, operationId);
    const requested = assertId(requestedVersionId, VERSION_ID, "versionId");
    const expected = assertSha256(expectedSourceSha256, "expectedSourceSha256");
    const expectedSnapshot = assertSha256(expectedSnapshotSha256, "expectedSnapshotSha256");
    let transaction = await readJsonFile(transactionPath, "history creation", { projectRootPath: loaded.paths.projectRootPath });
    if (transaction) {
      this.#assertHistoryCreation(loaded, transaction, operationId);
      if (transaction.basedOnVersionId !== requested || transaction.contentSha256 !== expectedSnapshot || transaction.expectedSourceSha256 !== expected
        || transaction.previousWorkingCopyId !== target.workingCopyId) {
        throw new ProjectFileRepositoryError("HISTORY_CREATION_OPERATION_MISMATCH", "This operation ID belongs to a different creation request.");
      }
    } else {
      if (loaded.runtime.activeRequest || loaded.runtime.activeCandidateId) {
        throw new ProjectFileRepositoryError("HISTORY_CREATION_RUN_LOCKED", "Finish the active AI task or Candidate decision before creating a Version.");
      }
      await this.#recoverProject(loaded.paths.projectRootPath);
      loaded = await this.#resolveMutationTarget(target);
      if (loaded.runtime.activeRequest || loaded.runtime.activeCandidateId) {
        throw new ProjectFileRepositoryError("HISTORY_CREATION_RUN_LOCKED", "Finish the active AI task or Candidate decision before creating a Version.");
      }
      if (loaded.runtime.activeWorkingCopyId !== loaded.workingCopy.workingCopyId || loaded.source.sha256 !== expected) {
        throw new ProjectFileRepositoryError("HISTORY_CREATION_SOURCE_CHANGED", "The current Working Copy changed before creation.");
      }
      const sourceVersion = loaded.manifest.versions.find((v) => v.versionId === requested);
      if (!sourceVersion) throw new ProjectFileRepositoryError("VERSION_NOT_FOUND", "The historical Version was not found.");
      if (sourceVersion.contentSha256 !== expectedSnapshot) throw new ProjectFileRepositoryError("VERSION_SNAPSHOT_HASH_MISMATCH", "The selected historical snapshot changed.");
      const snapshot = await readHtmlFile(versionSnapshotPath(loaded.paths, sourceVersion), "historical snapshot", { projectRootPath: loaded.paths.projectRootPath });
      if (snapshot.sha256 !== sourceVersion.contentSha256) throw new ProjectFileRepositoryError("VERSION_SNAPSHOT_HASH_MISMATCH", "The historical snapshot changed.");
      const latest = loaded.manifest.versions.find((v) => v.versionId === loaded.manifest.latestOfficialVersionId);
      const ordinal = latest.ordinal + 1;
      if (loaded.manifest.versions.some((v) => v.ordinal >= ordinal)) throw new ProjectFileRepositoryError("INVALID_MANIFEST", "The latest Version pointer is inconsistent.");
      const preferredFileStem = assertPreferredFileStem(loaded.workingCopy.preferredFileStem);
      const preferredExtension = htmlExtension(`x${loaded.workingCopy.preferredExtension}`);
      const allocation = await this.#allocateVersionWorkingCopy(loaded, { preferredFileStem, preferredExtension, versionOrdinal: ordinal });
      transaction = { schemaVersion: PROJECT_FILE_SCHEMA_VERSION, kind: "history-creation", state: "prepared",
        operationId, projectId: loaded.project.projectId, documentId: loaded.project.documentId,
        versionId: versionId(ordinal), versionOrdinal: ordinal, basedOnVersionId: requested,
        previousVersionId: latest.versionId, contentSha256: snapshot.sha256,
        previousWorkingCopyId: loaded.workingCopy.workingCopyId, expectedSourceSha256: expected,
        preferredFileStem, preferredExtension, finalWorkingCopyRelativePath: allocation.sourceRelativePath,
        pathAllocationOrdinal: allocation.allocationOrdinal, preparedFileIdentity: null,
        createdAt: nowIso(this.#clock), openedAt: null };
      await ensureProjectDirectory(loaded.paths.projectRootPath, path.dirname(transactionPath), "history creation transaction");
      await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, transaction, "history creation");
      await this.#hit("history-creation-prepared", { operationId });
    }
    return this.#runHistoryCreation(loaded, transaction);
  }

  async #cleanAbortedHistoryCreation(loaded, transaction) {
    const outcome = { status: "not-created", aborted: true, operationId: transaction.operationId,
      projectId: transaction.projectId, documentId: transaction.documentId,
      code: transaction.errorCode, reason: "创建前文件已变化，新版本未提交。请处理当前文件后重新创建。" };
    const committed = loaded.manifest.versions.find((v) => v.versionId === transaction.versionId);
    if (committed) {
      if (committed.sourceOperationId === transaction.operationId) throw new ProjectFileRepositoryError("HISTORY_CREATION_COMMIT_MISMATCH", "A committed Version cannot be aborted.");
      return outcome;
    }
    // Visible files may have been replaced externally. Keep them; only the
    // uncommitted private metadata is retired under Repository serialization.
    const safeRemove = async (filePath, label, check) => {
      const info = await regularInformation(filePath, label, { projectRootPath: loaded.paths.projectRootPath });
      if (!info) return;
      if (await check(info)) { await unlink(filePath); await syncDirectory(path.dirname(filePath)); }
    };
    const binding = await readSourceBinding(loaded.paths.projectRootPath, workingCopyId(transaction.versionOrdinal));
    const anchor = await regularInformation(path.join(path.dirname(this.#historyCreationPath(loaded, transaction.operationId)), "working-copy.anchor"),
      "history creation anchor", { projectRootPath: loaded.paths.projectRootPath });
    if (binding && anchor && sameFileIdentity(copyFileIdentity(binding.information), copyFileIdentity(anchor))) {
      await unlink(binding.bindingPath);
      await syncDirectory(path.dirname(binding.bindingPath));
    }
    const statePath = path.join(loaded.paths.controlRoot, `working-copies/${workingCopyId(transaction.versionOrdinal)}.json`);
    await safeRemove(statePath, "aborted Working Copy state", async () => {
      const state = await readJsonFile(statePath, "aborted Working Copy state", { projectRootPath: loaded.paths.projectRootPath });
      return state?.projectId === transaction.projectId && state.documentId === transaction.documentId
        && state.workingCopyId === workingCopyId(transaction.versionOrdinal)
        && state.lastSavedAt === transaction.createdAt && state.draftRevision === 0
        && state.draftSha256 === null && state.currentSha256 === transaction.contentSha256;
    });
    const snapshotPath = path.join(loaded.paths.versionsRoot, transaction.versionId, "index.html");
    await safeRemove(snapshotPath, "aborted Version snapshot", async () => (
      await readHtmlFile(snapshotPath, "aborted Version snapshot", { projectRootPath: loaded.paths.projectRootPath })
    ).sha256 === transaction.contentSha256);
    return outcome;
  }

  async #runHistoryCreation(loaded, transaction) {
    if (transaction.state === "aborted") return this.#cleanAbortedHistoryCreation(loaded, transaction);
    try { return await this.#continueHistoryCreation(loaded, transaction); }
    catch (cause) {
      if (!["HISTORY_CREATION_SOURCE_CHANGED", "HISTORY_CREATION_FILE_CHANGED", "VERSION_SNAPSHOT_HASH_MISMATCH"].includes(cause?.code)) throw cause;
      const latest = await this.#historyCreationLoaded({ projectId: loaded.project.projectId,
        documentId: loaded.project.documentId, projectRootPath: loaded.paths.projectRootPath });
      if (latest.manifest.versions.some((v) => v.versionId === transaction.versionId)) throw cause;
      transaction.state = "aborted";
      transaction.errorCode = cause.code;
      await atomicWriteProjectJson(latest.paths.projectRootPath, this.#historyCreationPath(latest, transaction.operationId), transaction, "history creation");
      return this.#cleanAbortedHistoryCreation(latest, transaction);
    }
  }

  async #continueHistoryCreation(initial, transaction) {
    const loaded = await this.#historyCreationLoaded({ projectId: initial.project.projectId,
      documentId: initial.project.documentId, projectRootPath: initial.paths.projectRootPath });
    const sourceVersion = this.#assertHistoryCreation(loaded, transaction, transaction.operationId);
    const transactionPath = this.#historyCreationPath(loaded, transaction.operationId);
    const writeTransaction = () => atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, transaction, "history creation");
    if (transaction.state === "completed") return this.#historyCreationResult(loaded, transaction);
    const committed = loaded.manifest.versions.some((v) => v.versionId === transaction.versionId);
    if (!committed) {
      const snapshot = await readHtmlFile(versionSnapshotPath(loaded.paths, sourceVersion), "historical snapshot", { projectRootPath: loaded.paths.projectRootPath });
      if (snapshot.sha256 !== transaction.contentSha256) throw new ProjectFileRepositoryError("VERSION_SNAPSHOT_HASH_MISMATCH", "The historical snapshot changed.");
      if (loaded.manifest.latestOfficialVersionId !== transaction.previousVersionId
        || loaded.runtime.activeWorkingCopyId !== transaction.previousWorkingCopyId
        || loaded.runtime.activeRequest || loaded.runtime.activeCandidateId) {
        throw new ProjectFileRepositoryError("HISTORY_CREATION_SOURCE_CHANGED", "The project changed before creation committed.");
      }
      const previous = loaded.manifest.workingCopies.find((w) => w.workingCopyId === transaction.previousWorkingCopyId);
      const current = await this.#resolveWorkingCopySource(loaded, previous);
      if (current.source.sha256 !== transaction.expectedSourceSha256) throw new ProjectFileRepositoryError("HISTORY_CREATION_SOURCE_CHANGED", "The protected Working Copy changed.");
      const nextVersion = { versionId: transaction.versionId, ordinal: transaction.versionOrdinal,
        basedOnVersionId: transaction.basedOnVersionId, previousVersionId: transaction.previousVersionId,
        contentSha256: transaction.contentSha256, snapshotRelativePath: `versions/${transaction.versionId}/index.html`,
        sourceType: "history-copy", sourceOperationId: transaction.operationId,
        sourceRequestId: null, sourceCandidateId: null, createdAt: transaction.createdAt };
      const snapshotPath = versionSnapshotPath(loaded.paths, nextVersion);
      await ensureProjectDirectory(loaded.paths.projectRootPath, path.dirname(snapshotPath), "new Version snapshot");
      await writeFileNoReplace(snapshotPath, snapshot.buffer, snapshot.sha256, "new Version snapshot", { projectRootPath: loaded.paths.projectRootPath });
      const preparedPath = path.join(path.dirname(transactionPath), `working-copy${transaction.preferredExtension}`);
      await writeFileNoReplace(preparedPath, snapshot.buffer, snapshot.sha256, "prepared history Working Copy", { projectRootPath: loaded.paths.projectRootPath });
      const preparedSource = await readHtmlFile(preparedPath, "prepared history Working Copy", { projectRootPath: loaded.paths.projectRootPath });
      const preparedIdentity = copyFileIdentity(preparedSource.information);
      const anchorPath = path.join(path.dirname(transactionPath), "working-copy.anchor");
      let anchor = await regularInformation(anchorPath, "history creation anchor", { projectRootPath: loaded.paths.projectRootPath });
      if (!anchor && transaction.state !== "prepared") {
        throw new ProjectFileRepositoryError("HISTORY_CREATION_FILE_CHANGED", "The preparation has no surviving private anchor.");
      }
      if (!anchor) {
        await link(preparedPath, anchorPath);
        await syncDirectory(path.dirname(anchorPath));
        anchor = await regularInformation(anchorPath, "history creation anchor", { projectRootPath: loaded.paths.projectRootPath });
      }
      if (!anchor || !sameFileIdentity(preparedIdentity, copyFileIdentity(anchor))) {
        throw new ProjectFileRepositoryError("HISTORY_CREATION_FILE_CHANGED", "The prepared Working Copy no longer matches its private anchor.");
      }
      if (transaction.state === "prepared") {
        transaction.preparedFileIdentity = preparedIdentity; // diagnostic observation only
        transaction.state = "working-copy-prepared";
        await writeTransaction();
        await this.#hit("history-creation-working-copy-prepared", { operationId: transaction.operationId });
      }
      let visiblePath;
      for (;;) {
        visiblePath = path.join(loaded.paths.projectRootPath, topLevelHtmlRelativePath(transaction.finalWorkingCopyRelativePath));
        const info = await lstat(visiblePath).catch((cause) => { if (cause.code === "ENOENT") return null; throw cause; });
        if (info && info.isFile() && !info.isSymbolicLink() && sameFileIdentity(copyFileIdentity(info), preparedIdentity)) break;
        if (transaction.state === "working-copy-created") {
          throw new ProjectFileRepositoryError("HISTORY_CREATION_FILE_CHANGED", "The published Working Copy was removed or replaced.");
        }
        if (info) {
          const allocation = await this.#allocateVersionWorkingCopy(loaded, { preferredFileStem: transaction.preferredFileStem,
            preferredExtension: transaction.preferredExtension, versionOrdinal: transaction.versionOrdinal, startAt: transaction.pathAllocationOrdinal + 1 });
          transaction.finalWorkingCopyRelativePath = allocation.sourceRelativePath;
          transaction.pathAllocationOrdinal = allocation.allocationOrdinal;
          await writeTransaction();
          continue;
        }
        await this.#hit("history-creation-before-link", { visiblePath, operationId: transaction.operationId });
        try { await link(preparedPath, visiblePath); await syncDirectory(loaded.paths.projectRootPath); }
        catch (cause) { if (cause.code === "EEXIST") continue; throw cause; }
      }
      const visible = await readHtmlFile(visiblePath, "new history Working Copy", { projectRootPath: loaded.paths.projectRootPath });
      if (visible.sha256 !== snapshot.sha256 || !sameFileIdentity(copyFileIdentity(visible.information), preparedIdentity)) {
        throw new ProjectFileRepositoryError("HISTORY_CREATION_FILE_CHANGED", "The new Working Copy changed before commit.");
      }
      const nextWorkingCopy = { workingCopyId: workingCopyId(transaction.versionOrdinal), versionId: transaction.versionId,
        basedOnVersionId: transaction.versionId, sourceRelativePath: transaction.finalWorkingCopyRelativePath,
        preferredFileStem: transaction.preferredFileStem, preferredExtension: transaction.preferredExtension,
        stateRelativePath: `working-copies/${workingCopyId(transaction.versionOrdinal)}.json`, fileIdentity: copyFileIdentity(visible.information) };
      const state = { schemaVersion: PROJECT_FILE_SCHEMA_VERSION, projectId: loaded.project.projectId, documentId: loaded.project.documentId,
        workingCopyId: nextWorkingCopy.workingCopyId, basedOnVersionId: transaction.versionId,
        baseSha256: snapshot.sha256, currentSha256: snapshot.sha256, differsFromBase: false,
        draftId: `draft_${nextWorkingCopy.workingCopyId}`, draftRelativePath: draftRelativePathFor(nextWorkingCopy),
        draftSha256: null, draftRevision: 0, saveState: "saved", lastPersistedRevision: 0,
        lastSavedAt: transaction.createdAt, lastOpenedAt: transaction.createdAt };
      const stateBytes = Buffer.from(jsonText(state));
      await writeFileNoReplace(workingCopyStatePath(loaded.paths, nextWorkingCopy), stateBytes, sha256(stateBytes), "new Working Copy state", { projectRootPath: loaded.paths.projectRootPath });
      transaction.state = "working-copy-created";
      await writeTransaction();
      await this.#hit("history-creation-working-copy-created", { operationId: transaction.operationId });
      await refreshSourceBinding(loaded.paths.projectRootPath, nextWorkingCopy.workingCopyId, visiblePath, snapshot.sha256,
        { expectedInformation: preparedSource.information });
      const currentAtCommit = await this.#resolveWorkingCopySource(loaded, previous);
      const visibleAtCommit = await readHtmlFile(visiblePath, "new history Working Copy", { projectRootPath: loaded.paths.projectRootPath });
      if (currentAtCommit.source.sha256 !== transaction.expectedSourceSha256
        || visibleAtCommit.sha256 !== snapshot.sha256
        || !sameFileIdentity(copyFileIdentity(visibleAtCommit.information), preparedIdentity)) {
        throw new ProjectFileRepositoryError("HISTORY_CREATION_FILE_CHANGED", "The Working Copy changed at commit.");
      }
      loaded.manifest.versions.push(nextVersion);
      loaded.manifest.workingCopies.push(nextWorkingCopy);
      loaded.manifest.latestOfficialVersionId = nextVersion.versionId;
      assertManifest(loaded.manifest, loaded.project);
      await atomicWriteProjectJson(loaded.paths.projectRootPath, loaded.paths.manifestPath, loaded.manifest, "manifest.json");
      transaction.state = "manifest-committed";
      await writeTransaction();
      await this.#hit("history-creation-manifest-committed", { operationId: transaction.operationId });
    }
    const result = await this.#historyCreationResult(loaded, transaction);
    loaded.runtime.activeWorkingCopyId = result.workingCopyId;
    loaded.runtime.historyCreation = { operationId: transaction.operationId, versionId: transaction.versionId };
    await this.#writeRuntime(loaded);
    transaction.state = "completed";
    await writeTransaction();
    await this.#hit("history-creation-completed", { operationId: transaction.operationId });
    return this.#historyCreationResult(loaded, transaction);
  }

  async #queryHistoryCreation({ target, operationId, markOpened = false }) {
    const loaded = await this.#historyCreationLoaded(target);
    const transactionPath = this.#historyCreationPath(loaded, operationId);
    const transaction = await readJsonFile(transactionPath, "history creation", { projectRootPath: loaded.paths.projectRootPath });
    if (!transaction) return { status: "not-created", operationId, projectId: loaded.project.projectId, documentId: loaded.project.documentId };
    this.#assertHistoryCreation(loaded, transaction, operationId);
    const result = await this.#runHistoryCreation(loaded, transaction);
    if (markOpened && result.status === "created" && !transaction.openedAt) {
      transaction.openedAt = nowIso(this.#clock);
      await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, transaction, "history creation");
      result.openedAt = transaction.openedAt;
      if (result.recoveryState === "pending") result.recoveryState = "opened";
    }
    return result;
  }

  async #promoteCandidate({ target, candidateId, expectedSourceSha256, decisionOperationId }) {
    const requestedCandidateId = assertCandidateId(candidateId);
    const expectedDecisionOperationId = `promote_${requestedCandidateId}`;
    if (decisionOperationId !== expectedDecisionOperationId) {
      throw new ProjectFileRepositoryError(
        "DECISION_IDENTITY_MISMATCH",
        "Adoption identity does not match this Candidate.",
      );
    }
    const loaded = await this.#historyCreationLoaded(target);
    return this.#promoteCurrentCandidate(loaded, {
        target,
        candidateId: requestedCandidateId,
        expectedSourceSha256,
        decisionOperationId,
      });
  }

  async #assertCandidateSourceCurrent(loaded, candidate) {
    const sourceWorkingCopyId = assertId(
      candidate.sourceWorkingCopyId,
      WORKING_COPY_ID,
      "Candidate sourceWorkingCopyId",
    );
    const expectedSourceSha256 = assertSha256(
      candidate.expectedSourceSha256,
      "Candidate expectedSourceSha256",
    );
    const sourceWorkingCopy = loaded.manifest.workingCopies.find(
      (workingCopy) => workingCopy.workingCopyId === sourceWorkingCopyId,
    );
    if (!sourceWorkingCopy) {
      throw new ProjectFileRepositoryError(
        "CANDIDATE_WORKING_COPY_MISSING",
        "The Candidate source Working Copy is no longer available.",
        { candidateId: candidate.candidateId, sourceWorkingCopyId },
      );
    }
    const source = await readHtmlFile(
      workingCopySourcePath(loaded.paths, sourceWorkingCopy),
      "Candidate Working Copy",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (source.sha256 !== expectedSourceSha256) {
      throw new ProjectFileRepositoryError(
        "CANDIDATE_SOURCE_CHANGED",
        "The Working Copy changed after Candidate validation and cannot be adopted yet.",
        {
          expectedSourceSha256,
          actualSourceSha256: source.sha256,
          candidateId: candidate.candidateId,
          sourceWorkingCopyId,
        },
      );
    }
    return source;
  }

  async #recoverSaveTransaction(loaded, transactionPath, transaction) {
    if (
      !isObject(transaction)
      || transaction.schemaVersion !== PROJECT_FILE_SCHEMA_VERSION
      || transaction.kind !== "save"
      || !["prepared", "committed", "conflict"].includes(transaction.state)
      || !transaction.recoveryId
      || transaction.projectId !== loaded.project.projectId
      || transaction.documentId !== loaded.project.documentId
    ) {
      throw new ProjectFileRepositoryError(
        "SAVE_TRANSACTION_INVALID",
        "The Working Copy save transaction is invalid.",
      );
    }
    const id = assertId(transaction.workingCopyId, WORKING_COPY_ID, "workingCopyId");
    const workingCopy = loaded.manifest.workingCopies.find(
      (entry) => entry.workingCopyId === id,
    );
    if (!workingCopy || transaction.sourceRelativePath !== workingCopy.sourceRelativePath) {
      throw new ProjectFileRepositoryError(
        "SAVE_TRANSACTION_IDENTITY_MISMATCH",
        "The Working Copy save transaction no longer matches manifest.json.",
      );
    }
    const expected = assertSha256(
      transaction.expectedSourceSha256,
      "save transaction expectedSourceSha256",
    );
    const target = assertSha256(
      transaction.targetSourceSha256,
      "save transaction targetSourceSha256",
    );
    const sourcePath = workingCopySourcePath(loaded.paths, workingCopy);
    const statePath = workingCopyStatePath(loaded.paths, workingCopy);
    const currentState = await readJsonFile(statePath, "Working Copy state", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (!currentState) {
      throw new ProjectFileRepositoryError(
        "WORKING_COPY_STATE_NOT_FOUND",
        "The Working Copy state is missing during save recovery.",
      );
    }
    assertWorkingCopyState(currentState, loaded, workingCopy);
    const revision = Number.isSafeInteger(Number(transaction.editRevision))
      && Number(transaction.editRevision) >= 0
      ? Number(transaction.editRevision)
      : Number(currentState.lastPersistedRevision || 0);
    const commitSavedSource = async (source) => {
      await refreshSourceBinding(loaded.paths.projectRootPath, workingCopy.workingCopyId, sourcePath, target);
      workingCopy.fileIdentity = copyFileIdentity(source.information);
      const savedAt = String(transaction.committedAt || transaction.preparedAt || nowIso(this.#clock));
      await atomicWriteProjectJson(loaded.paths.projectRootPath, statePath, {
        ...currentState,
        schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
        projectId: loaded.project.projectId,
        documentId: loaded.project.documentId,
        workingCopyId: workingCopy.workingCopyId,
        currentSha256: target,
        differsFromBase: target !== currentState.baseSha256,
        saveState: "saved",
        lastPersistedRevision: Math.max(
          Number(currentState.lastPersistedRevision || 0),
          revision,
        ),
        lastSavedAt: savedAt,
        ...(currentState.sourceElementIdentitySchemaVersion
          === STEMMIO_ELEMENT_ID_SCHEMA_VERSION
          ? {
              sourceElementIdentityBindingSha256:
                sourceElementIdentityBindingSha256(source.html),
            }
          : {}),
      }, "Working Copy state");
      await atomicWriteProjectJson(
        loaded.paths.projectRootPath,
        loaded.paths.manifestPath,
        loaded.manifest,
        "manifest.json",
      );
      if (transaction.state !== "committed") {
        await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, {
          ...transaction,
          state: "committed",
          committedAt: nowIso(this.#clock),
          recoveredAt: nowIso(this.#clock),
        }, "save transaction");
      }
      return {
        kind: "save",
        workingCopyId: workingCopy.workingCopyId,
        state: "committed",
      };
    };
    const commitRolledBack = async (recovery) => {
      await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, {
        ...transaction,
        state: "committed",
        committedAt: nowIso(this.#clock),
        recovery,
      }, "save transaction");
      return {
        kind: "save",
        workingCopyId: workingCopy.workingCopyId,
        state: "rolled-back",
      };
    };

    const recoveryPaths = saveRecoveryPaths(
      loaded.paths,
      workingCopy.workingCopyId,
      transaction.editRevision,
      transaction.recoveryId,
    );
    const source = await readRegularFileWithSha256(sourcePath, "Working Copy", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    const previous = await readRegularFileWithSha256(
      recoveryPaths.previousPath,
      "saved Working Copy",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    const next = await readRegularFileWithSha256(
      recoveryPaths.nextPath,
      "save replacement bytes",
      { projectRootPath: loaded.paths.projectRootPath },
    );
    if (transaction.state === "conflict") {
      throw new ProjectFileRepositoryError(
        "SAVE_RECOVERY_CONFLICT",
        "The Working Copy changed during an interrupted save and was not overwritten.",
        {
          workingCopyId: workingCopy.workingCopyId,
          expectedSourceSha256: expected,
          targetSourceSha256: target,
          actualSourceSha256: source?.sha256 || null,
          parkedSourceSha256: previous?.sha256 || null,
        },
      );
    }
    if (source?.sha256 === target) {
      // `committed` means Stemmio published its new source and metadata, not
      // that the parked old inode has become irrelevant. An external editor
      // can retain an FD to previous.html across a crash at this point, so
      // preserve and surface its late write before treating the save as done.
      if (previous && previous.sha256 !== expected) {
        await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, {
          ...transaction,
          state: "conflict",
          recovery: "parked-source-changed-after-publish",
          parkedSourceSha256: previous.sha256,
          retainedAt: nowIso(this.#clock),
        }, "save transaction");
        throw new ProjectFileRepositoryError(
          "SAVE_RECOVERY_CONFLICT",
          "The Working Copy changed through an already-open external file after Stemmio saved it; the external bytes were retained for recovery.",
          {
            workingCopyId: workingCopy.workingCopyId,
            expectedSourceSha256: expected,
            targetSourceSha256: target,
            parkedSourceSha256: previous.sha256,
          },
        );
      }
      const saved = await readHtmlFile(sourcePath, "Working Copy", {
        projectRootPath: loaded.paths.projectRootPath,
      });
      const committed = await commitSavedSource(saved);
      await this.#retireCommittedSave(loaded, transactionPath, {
        ...transaction, state: "committed",
      });
      return committed;
    }
    if (!source && previous) {
      if (previous.sha256 === expected && next?.sha256 === target) {
        try {
          await linkFileNoReplace(
            recoveryPaths.nextPath,
            sourcePath,
            target,
            "Working Copy",
            { projectRootPath: loaded.paths.projectRootPath },
          );
        } catch (cause) {
          throw new ProjectFileRepositoryError(
            "SAVE_RECOVERY_CONFLICT",
            "The Working Copy changed while an interrupted save was being recovered.",
            {
              workingCopyId: workingCopy.workingCopyId,
              expectedSourceSha256: expected,
              targetSourceSha256: target,
              cause: cause instanceof Error ? cause.message : String(cause),
            },
          );
        }
        const saved = await readHtmlFile(sourcePath, "Working Copy", {
          projectRootPath: loaded.paths.projectRootPath,
        });
        if (saved.sha256 !== target) {
          throw new ProjectFileRepositoryError(
            "SAVE_RECOVERY_CONFLICT",
            "The Working Copy changed while an interrupted save was being verified.",
            {
              workingCopyId: workingCopy.workingCopyId,
              expectedSourceSha256: expected,
              targetSourceSha256: target,
              actualSourceSha256: saved.sha256,
            },
          );
        }
        return commitSavedSource(saved);
      }
      if (previous.sha256 !== expected) {
        try {
          await linkFileNoReplace(
            recoveryPaths.previousPath,
            sourcePath,
            previous.sha256,
            "Working Copy recovery",
            { projectRootPath: loaded.paths.projectRootPath },
          );
          await unlink(recoveryPaths.previousPath);
          await syncDirectory(recoveryPaths.operationRoot);
          return commitRolledBack("source-changed-before-park");
        } catch (cause) {
          throw new ProjectFileRepositoryError(
            "SAVE_RECOVERY_CONFLICT",
            "The externally changed Working Copy could not be restored safely.",
            {
              workingCopyId: workingCopy.workingCopyId,
              expectedSourceSha256: expected,
              targetSourceSha256: target,
              cause: cause instanceof Error ? cause.message : String(cause),
            },
          );
        }
      }
    }
    if (source?.sha256 === expected) {
      return commitRolledBack("source-unchanged");
    }
    if (source && !previous && transaction.state === "prepared") {
      // Visible bytes are neither the expected old source nor the prepared
      // replacement. Stemmio never mixes those histories: keep both complete
      // sequences and fail closed.
      throw new ProjectFileRepositoryError(
        "SAVE_RECOVERY_CONFLICT",
        "The Working Copy changed during an interrupted save and was not overwritten.",
        {
          workingCopyId: workingCopy.workingCopyId,
          expectedSourceSha256: expected,
          targetSourceSha256: target,
          actualSourceSha256: source.sha256,
        },
      );
    }
    if (!source && next && next.sha256 !== target) {
      throw new ProjectFileRepositoryError(
        "SAVE_TRANSACTION_INVALID",
        "The staged Working Copy bytes no longer match the save transaction.",
      );
    }
    throw new ProjectFileRepositoryError(
      "SAVE_RECOVERY_CONFLICT",
      "The Working Copy changed during an interrupted save and was not overwritten.",
      {
        workingCopyId: workingCopy.workingCopyId,
        expectedSourceSha256: expected,
        targetSourceSha256: target,
        actualSourceSha256: source?.sha256 || null,
        parkedSourceSha256: previous?.sha256 || null,
      },
    );
  }

  async #recoverRequestRuntime(loaded) {
    const runtimeAnchor = loaded.runtime.activeRequest;
    // Request / Attempt files are writable by the external Agent. They are
    // evidence to validate against Stemmio-owned runtime state, never a
    // source from which reopening may infer new active-work authority.
    if (!runtimeAnchor) return null;
    const workingCopy = loaded.manifest.workingCopies.find(
      (candidate) => candidate.workingCopyId === loaded.runtime.activeWorkingCopyId,
    );
    if (!workingCopy) {
      throw new ProjectFileRepositoryError(
        "REQUEST_RUNTIME_ANCHOR_MISMATCH",
        "The active Request has no registered Working Copy runtime anchor.",
        {
          requestId: runtimeAnchor.requestId,
          attemptId: runtimeAnchor.attemptId,
        },
      );
    }
    const requestPath = path.join(
      requestRootPath(loaded.paths, runtimeAnchor.requestId),
      "request.json",
    );
    const record = await readJsonFile(requestPath, "request.json", {
      projectRootPath: loaded.paths.projectRootPath,
    });
    if (!record) {
      throw new ProjectFileRepositoryError(
        "REQUEST_RUNTIME_ANCHOR_MISSING",
        "The active Request record is unavailable; Stemmio will not infer replacement Request authority.",
        {
          requestId: runtimeAnchor.requestId,
          attemptId: runtimeAnchor.attemptId,
        },
      );
    }
    this.#assertRequestRecord(record, { ...loaded, workingCopy }, {
      requestId: runtimeAnchor.requestId,
      attemptId: runtimeAnchor.attemptId,
    });
    const restored = await this.#restoreRequestRuntime(
      { ...loaded, workingCopy },
      record,
    );
    return restored
      ? { kind: "request-runtime", requestId: record.requestId, state: record.status }
      : null;
  }

  async #recoverProject(projectRootPath) {
    const declaredProjectRootPath = normalizedPath(projectRootPath);
    const registry = await this.#readRegistry();
    const matched = Object.entries(registry.projects).find(([, record]) => (
      samePath(record.registeredProjectRootPath, declaredProjectRootPath)
    ));
    if (!matched) {
      throw new ProjectFileRepositoryError(
        "REGISTERED_PROJECT_UNAVAILABLE",
        "Recovery is limited to a Registry-authorized project root.",
        { projectRootPath: declaredProjectRootPath },
      );
    }
    const [projectId, record] = matched;
    const loaded = await this.#loadRegisteredProject({
      projectId,
      declaredProjectRootPath: record.registeredProjectRootPath,
    });
    const recovered = [];
    const entries = await listProjectDirectory(
      loaded.paths.projectRootPath,
      loaded.paths.transactionsRoot,
      "transactions",
    );
    const saveRetirementCandidates = [];
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory() && entry.name.startsWith("current_")) {
        const transaction = await readJsonFile(path.join(loaded.paths.transactionsRoot, entry.name, "transaction.json"), "current Version transaction", { projectRootPath: loaded.paths.projectRootPath });
        if (transaction && transaction.state !== "unchanged" && transaction.state !== "aborted" && (transaction.state !== "completed" || (transaction.sourceType === "internal-ai" && loaded.runtime.activeCandidateId && loaded.runtime.activeCandidateId === transaction.version?.sourceCandidateId))) {
          assertCurrentVersionTransaction(loaded, transaction, entry.name.slice("current_".length));
          recovered.push(transaction.sourceType === "internal-ai"
            ? await this.#resumeCurrentPromotion(loaded, transaction)
            : await commitCurrentVersion(loaded, transaction, { hit: (name) => this.#hit(name) }));
        }
        continue;
      }
      if (
        entry.isFile()
        && entry.name.startsWith("identity_")
        && entry.name.endsWith(".json")
      ) {
        const transactionPath = path.join(loaded.paths.transactionsRoot, entry.name);
        const transaction = await readJsonFile(
          transactionPath,
          "source element identity migration",
          { projectRootPath: loaded.paths.projectRootPath },
        );
        let committedRecoveryDirectory = false;
        if (transaction?.state === "committed") {
          const { recoveryPaths } =
            this.#assertSourceElementIdentityMigrationTransaction(loaded, transaction);
          committedRecoveryDirectory = Boolean(await directoryInformation(
            recoveryPaths.operationRoot,
            "source element identity recovery directory",
            { projectRootPath: loaded.paths.projectRootPath },
          ));
        }
        if (transaction?.state !== "committed" || committedRecoveryDirectory) {
          recovered.push(await this.#recoverSourceElementIdentityMigration(
            loaded,
            transactionPath,
            transaction,
          ));
        }
        continue;
      }
      if (entry.isFile() && entry.name.startsWith("save_") && entry.name.endsWith(".json")) {
        const transactionPath = path.join(loaded.paths.transactionsRoot, entry.name);
        const transaction = await readJsonFile(transactionPath, "save transaction", {
          projectRootPath: loaded.paths.projectRootPath,
        });
        let committedRecoveryDirectory = false;
        if (
          transaction?.state === "committed"
          && isObject(transaction)
          && Object.hasOwn(transaction, "recoveryId")
        ) {
          const recoveryPaths = saveRecoveryPaths(
            loaded.paths,
            transaction.workingCopyId,
            transaction.editRevision,
            transaction.recoveryId,
          );
          committedRecoveryDirectory = Boolean(await directoryInformation(
            recoveryPaths.operationRoot,
            "save recovery directory",
            { projectRootPath: loaded.paths.projectRootPath },
          ));
        }
        if (transaction?.state !== "committed" || committedRecoveryDirectory) {
          recovered.push(await this.#recoverSaveTransaction(
            loaded,
            transactionPath,
            transaction,
          ));
        } else if (transaction?.recoveryId && !transaction.recovery) {
          saveRetirementCandidates.push({ transactionPath, transaction });
        }
        continue;
      }
      if (entry.isDirectory() && entry.name.startsWith("history_")) {
        const transaction = await readJsonFile(path.join(loaded.paths.transactionsRoot, entry.name, "transaction.json"),
          "history creation", { projectRootPath: loaded.paths.projectRootPath });
        if (transaction) {
          this.#assertHistoryCreation(loaded, transaction, entry.name.slice("history_".length));
          if (transaction.state !== "completed") recovered.push(await this.#withRegistryWriteLock(() => this.#runHistoryCreation(loaded, transaction)));
        }
        continue;
      }
      if (entry.isDirectory() && entry.name.startsWith("promote_")) {
        // Candidate adoption uses the current-version transaction. A retired
        // promotion journal is an unsupported format, never a recovery input.
        throw new ProjectFileRepositoryError(
          "UNSUPPORTED_TRANSACTION_FORMAT",
          "Legacy promotion transactions are not supported.",
        );
      }
    }
    // Scan every cheap journal record so stale entries cannot permanently hide
    // a later eligible one, then cap the identity/Hash/durability work itself.
    await this.#retireCommittedSaveStock(loaded, saveRetirementCandidates);
    const requestFreezes = await this.#recoverRequestFreezes(loaded);
    recovered.push(...requestFreezes);
    // A crash after candidate.json becomes promoted but before request.json
    // follows leaves an intentional intermediate state. Restore Request facts
    // only after current-version recovery has completed.
    const requestRuntime = await this.#recoverRequestRuntime(loaded);
    if (requestRuntime) recovered.push(requestRuntime);
    await this.#recoverSubmissionHistory(loaded);
    return recovered;
  }
}

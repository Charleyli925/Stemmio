// Repository transaction procedures. They own no queue or independently writable state.
import { link, rename, readdir } from "node:fs/promises";
import path from "node:path";
import { jsonText, sha256, syncDirectory } from "../lifecycle-core.mjs";
import { ProjectFileRepositoryError } from "./errors.mjs";
import { SAFE_OPERATION_ID, PROJECT_FILE_SCHEMA_VERSION } from "./constants.mjs";
import { assertManifest } from "./registry.mjs";
import { versionId } from "./identity.mjs";
import { versionSnapshotPath } from "./version-candidate.mjs";
import { assertWorkingCopyDraft, draftPathForState } from "./request-draft.mjs";
import {
  assertSha256, atomicWriteProjectJson, copyFileIdentity, directoryInformation,
  ensureProjectDirectory, ensureRelativePath, readHtmlFile, readJsonFile,
  readJsonFileWithSha256, readRegularFileWithSha256, regularInformation,
  sameFileIdentity, writeFileNoReplace,
} from "./path-safety.mjs";
import {
  assertWorkingCopyState, compareAndSwapWorkingCopyFile, draftRelativePathFor,
  materializeSourceElementIdentity, sourceElementIdentityBindingSha256,
  workingCopySourcePath, workingCopyStatePath,
} from "./working-copy.mjs";
import { findBoundSource, refreshSourceBinding } from "./source-binding.mjs";

export const CURRENT_DRAFT_SCHEMA_VERSION = "1.0.0";
const TYPES = new Set(["local-save", "history-copy", "recovery-copy", "internal-ai"]);
const fail = (code, message) => { throw new ProjectFileRepositoryError(code, message); };
const encoded = (value) => Buffer.from(jsonText(value));
const recoveryIdentity = (operationId) => `replaced_${sha256(Buffer.from(operationId)).slice(7, 39)}`;
const options = (loaded) => ({ projectRootPath: loaded.paths.projectRootPath });

function checkedId(value) {
  if (!SAFE_OPERATION_ID.test(String(value || ""))) fail("INVALID_OPERATION_ID", "The operation identity is invalid.");
  return value;
}

export function currentVersionTransactionPath(loaded, operationId) {
  return path.join(loaded.paths.transactionsRoot, `current_${checkedId(operationId)}`, "transaction.json");
}

function preservedRoot(loaded, recoveryId) {
  return path.join(loaded.paths.recoveryRoot, "preserved-drafts", checkedId(recoveryId));
}

export function currentVersionNoopResult(loaded, receipt, operationId) {
  const result = receipt?.result;
  const member = loaded.manifest.workingCopies.find((entry) => entry.workingCopyId === result?.workingCopyId);
  const version = loaded.manifest.versions.find((entry) => entry.versionId === result?.versionId);
  if (receipt?.schemaVersion !== CURRENT_DRAFT_SCHEMA_VERSION || receipt.kind !== "current-version-noop"
    || receipt.operationId !== checkedId(operationId) || receipt.projectId !== loaded.project.projectId
    || receipt.documentId !== loaded.project.documentId || receipt.state !== "unchanged" || receipt.sourceType !== "local-save"
    || receipt.recoveryId !== null || result?.status !== "unchanged" || result.operationId !== operationId
    || result.projectId !== loaded.project.projectId || result.documentId !== loaded.project.documentId
    || result.sourceSha256 !== assertSha256(receipt.expectedSourceSha256, "unchanged source")
    || !member || !version || version.ordinal !== result.versionOrdinal) {
    fail("CURRENT_VERSION_INVALID", "The unchanged Version receipt is inconsistent.");
  }
  return { ...result, sourcePath: workingCopySourcePath(loaded.paths, member) };
}

export async function currentDraftEvidence(loaded, workingCopy, source = null) {
  source ||= await readHtmlFile(workingCopySourcePath(loaded.paths, workingCopy), "current draft", options(loaded));
  const state = await readJsonFile(workingCopyStatePath(loaded.paths, workingCopy), "current draft state", options(loaded));
  assertWorkingCopyState(state, loaded, workingCopy, { allowMissingIdentityBinding: true });
  const file = await readJsonFileWithSha256(draftPathForState(loaded.paths, workingCopy, state), "current comments", options(loaded));
  if (state.draftSha256) {
    if (!file) fail("WORKING_COPY_DRAFT_INVALID", "The saved comments are missing.");
    assertWorkingCopyDraft(file.value, file.sha256, state, loaded, workingCopy);
  } else if (file) fail("WORKING_COPY_DRAFT_INVALID", "Unregistered comments cannot be discarded.");
  return { source, state, draft: file?.value || null };
}

export async function preserveDraft(loaded, workingCopy, evidence, { recoveryId, reason, createdAt }) {
  const root = preservedRoot(loaded, recoveryId);
  const existing = await readJsonFile(path.join(root, "record.json"), "preserved draft", options(loaded));
  if (existing) {
    const checked = await readPreservedDraft(loaded, recoveryId);
    if (checked.sourceSha256 !== evidence.source.sha256 || checked.originalWorkingCopyId !== workingCopy.workingCopyId
      || JSON.stringify(checked.draft) !== JSON.stringify(evidence.draft)) {
      fail("PRESERVED_DRAFT_CONFLICT", "This recovery identity already preserves different content.");
    }
    return checked;
  }
  await ensureProjectDirectory(loaded.paths.projectRootPath, root, "preserved draft");
  await writeFileNoReplace(path.join(root, "index.html"), evidence.source.buffer, evidence.source.sha256, "preserved HTML", options(loaded));
  const attachments = [];
  for (const comment of evidence.draft?.comments || []) {
    for (const attachment of comment.attachments || []) {
      const relativePath = ensureRelativePath(attachment.relativePath, "attachment path");
      if (!relativePath.startsWith("draft/attachments/")) fail("PRESERVED_DRAFT_INVALID", "An attachment is outside its draft.");
      const input = path.join(loaded.paths.projectRootPath, relativePath);
      const bytes = await readRegularFileWithSha256(input, "draft attachment", options(loaded));
      if (!bytes || (attachment.sha256 && bytes.sha256 !== attachment.sha256)) fail("PRESERVED_DRAFT_INVALID", "A draft attachment cannot be verified.");
      const destination = path.join(root, relativePath);
      await ensureProjectDirectory(loaded.paths.projectRootPath, path.dirname(destination), "preserved attachments");
      await writeFileNoReplace(destination, bytes.buffer, bytes.sha256, "preserved attachment", options(loaded));
      attachments.push({ relativePath, sha256: bytes.sha256, byteLength: bytes.buffer.length });
    }
  }
  const originalBinding = path.join(root, "original-binding.ref");
  try { await link(workingCopySourcePath(loaded.paths, workingCopy), originalBinding); }
  catch (cause) { if (cause?.code !== "EEXIST") throw cause; }
  const originalInformation = await regularInformation(originalBinding, "preserved original binding", options(loaded));
  if (!sameFileIdentity(copyFileIdentity(originalInformation), copyFileIdentity(evidence.source.information))) fail("WORKING_COPY_CONFLICT", "The draft changed while preserving its original file.");
  const record = {
    schemaVersion: CURRENT_DRAFT_SCHEMA_VERSION, projectId: loaded.project.projectId,
    documentId: loaded.project.documentId, recoveryId, reason, createdAt,
    originalWorkingCopyId: workingCopy.workingCopyId, basedOnVersionId: workingCopy.basedOnVersionId,
    originalSourceRelativePath: workingCopy.sourceRelativePath, sourceSha256: evidence.source.sha256,
    state: evidence.state, draft: evidence.draft, attachments,
  };
  const bytes = encoded(record);
  await writeFileNoReplace(path.join(root, "record.json"), bytes, sha256(bytes), "preserved draft record", options(loaded));
  return readPreservedDraft(loaded, recoveryId);
}

export async function readPreservedDraft(loaded, recoveryId) {
  const root = preservedRoot(loaded, recoveryId);
  const record = await readJsonFile(path.join(root, "record.json"), "preserved draft", options(loaded));
  if (!record || record.schemaVersion !== CURRENT_DRAFT_SCHEMA_VERSION
    || record.projectId !== loaded.project.projectId || record.documentId !== loaded.project.documentId
    || record.recoveryId !== recoveryId || !Array.isArray(record.attachments)) {
    fail("PRESERVED_DRAFT_INVALID", "The preserved draft identity is invalid.");
  }
  const original = { workingCopyId: record.originalWorkingCopyId, basedOnVersionId: record.basedOnVersionId };
  assertWorkingCopyState(record.state, loaded, original, { allowMissingIdentityBinding: true });
  if (record.draft) assertWorkingCopyDraft(record.draft, sha256(encoded(record.draft)), record.state, loaded, original);
  else if (record.state.draftSha256) fail("PRESERVED_DRAFT_INVALID", "The preserved comments are missing.");
  const source = await readHtmlFile(path.join(root, "index.html"), "preserved HTML", options(loaded));
  if (source.sha256 !== record.sourceSha256) fail("PRESERVED_DRAFT_INVALID", "The preserved HTML changed.");
  for (const attachment of record.attachments) {
    const relative = ensureRelativePath(attachment.relativePath, "preserved attachment path");
    if (!relative.startsWith("draft/attachments/")) fail("PRESERVED_DRAFT_INVALID", "The preserved attachment path is invalid.");
    const bytes = await readRegularFileWithSha256(path.join(root, relative), "preserved attachment", options(loaded));
    if (!bytes || bytes.sha256 !== attachment.sha256 || bytes.buffer.length !== attachment.byteLength) fail("PRESERVED_DRAFT_INVALID", "A preserved attachment changed.");
  }
  return { ...record, html: source.html, hasComments: Boolean(record.draft?.comments?.length), attachmentCount: record.attachments.length };
}

export async function listPreservedDrafts(loaded) {
  const root = path.join(loaded.paths.recoveryRoot, "preserved-drafts");
  if (!await directoryInformation(root, "preserved drafts", options(loaded))) return [];
  const results = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || !SAFE_OPERATION_ID.test(entry.name)) continue;
    // An unfinished preservation has no published record and is not a recovery offer.
    if (!await regularInformation(path.join(root, entry.name, "record.json"), "preserved draft record", options(loaded))) continue;
    const record = await readPreservedDraft(loaded, entry.name);
    const summary = { ...record };
    for (const field of ["html", "draft", "state", "attachments"]) delete summary[field];
    results.push(summary);
  }
  return results.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function verifyReplacedCurrentDraft(loaded, { journal, currentSourcePath, currentSource }) {
  const member = loaded.manifest.workingCopies.find((entry) => entry.workingCopyId === loaded.runtime.activeWorkingCopyId);
  const currentVersion = loaded.manifest.versions.find((version) => version.versionId === member?.versionId);
  if (!currentVersion || loaded.manifest.currentDraftSchemaVersion !== CURRENT_DRAFT_SCHEMA_VERSION
    || !journal || journal.projectId !== loaded.project.projectId || journal.documentId !== loaded.project.documentId
    || journal.workingCopyId !== member.workingCopyId || typeof journal.sourcePath !== "string" || !journal.sourcePath
    || typeof journal.html !== "string" || !Number.isSafeInteger(journal.revision) || journal.revision < 0
    || (journal.changeEvents !== undefined && !Array.isArray(journal.changeEvents))) return { verified: false };
  const journalBytes = Buffer.from(journal.html, "utf8");
  const journalHash = sha256(journalBytes);
  if (journalHash !== journal.recoveryHtmlSha256 || journalHash !== journal.expectedSourceSha256) return { verified: false };
  assertSha256(journal.journalSha256, "journalSha256");
  // Only official replacement operations for this current member may supply
  // preservation evidence. A matching HTML hash elsewhere is never authority.
  for (const version of [...loaded.manifest.versions].reverse()) {
    if (version.ordinal > currentVersion.ordinal || !version.sourceOperationId
      || !["history-copy", "recovery-copy", "internal-ai"].includes(version.sourceType)) continue;
    const transactionPath = currentVersionTransactionPath(loaded, version.sourceOperationId);
    const transaction = await readJsonFile(transactionPath, "replacement transaction", options(loaded));
    if (!transaction || transaction.state !== "completed") continue;
    assertCurrentVersionTransaction(loaded, transaction, version.sourceOperationId);
    if (JSON.stringify(transaction.version) !== JSON.stringify(version)
      || transaction.beforeMember.workingCopyId !== journal.workingCopyId
      || transaction.expectedSourceSha256 !== journal.expectedSourceSha256) continue;
    const recoveryId = recoveryIdentity(transaction.operationId);
    const preserved = await readPreservedDraft(loaded, recoveryId);
    if (preserved.originalWorkingCopyId !== transaction.beforeMember.workingCopyId
      || preserved.originalSourceRelativePath !== transaction.beforeMember.sourceRelativePath
      || preserved.basedOnVersionId !== transaction.beforeMember.basedOnVersionId
      || preserved.reason !== transaction.sourceType || preserved.createdAt !== transaction.createdAt
      || preserved.sourceSha256 !== transaction.expectedSourceSha256
      || JSON.stringify(preserved.state) !== JSON.stringify(transaction.beforeState)
      || JSON.stringify(preserved.draft) !== JSON.stringify(transaction.beforeDraft)
      || !Buffer.from(preserved.html, "utf8").equals(journalBytes)) continue;
    const draftAttachments = (transaction.beforeDraft?.comments || []).flatMap((comment) => comment.attachments || []);
    if (draftAttachments.length !== preserved.attachments.length || draftAttachments.some((attachment, index) => {
      const saved = preserved.attachments[index];
      return attachment.relativePath !== saved.relativePath || (attachment.sha256 && attachment.sha256 !== saved.sha256)
        || (attachment.byteLength !== undefined && attachment.byteLength !== saved.byteLength);
    })) continue;
    const before = await readHtmlFile(path.join(path.dirname(transactionPath), "before.html"), "replacement before HTML", options(loaded));
    const snapshot = await readHtmlFile(versionSnapshotPath(loaded.paths, version), "committed replacement Version", options(loaded));
    const originalBinding = await regularInformation(path.join(preservedRoot(loaded, recoveryId), "original-binding.ref"), "preserved source binding", options(loaded));
    const transactionBinding = await regularInformation(path.join(path.dirname(transactionPath), "before-binding.ref"), "replacement source binding", options(loaded));
    if (!before.buffer.equals(journalBytes) || snapshot.sha256 !== version.contentSha256
      || !originalBinding || !transactionBinding
      || !sameFileIdentity(copyFileIdentity(originalBinding), copyFileIdentity(transactionBinding))) continue;
    if ((journal.changeEvents || []).some((event) => !preserved.draft?.changeEvents?.some(
      (saved) => JSON.stringify(saved) === JSON.stringify(event),
    ))) continue;
    return { verified: true, proof: {
      projectId: loaded.project.projectId, documentId: loaded.project.documentId, workingCopyId: member.workingCopyId,
      currentVersionId: currentVersion.versionId, currentSourcePath, currentSourceSha256: currentSource.sha256,
      replacementVersionId: version.versionId, operationId: transaction.operationId,
      preservedRecoveryId: recoveryId, replacedSourceSha256: preserved.sourceSha256,
      journalSha256: journal.journalSha256, journalRevision: journal.revision,
    } };
  }
  return { verified: false };
}

export async function restorePreservedAttachments(loaded, record) {
  for (const attachment of record.attachments) {
    const input = path.join(preservedRoot(loaded, record.recoveryId), attachment.relativePath);
    const bytes = await readRegularFileWithSha256(input, "preserved attachment", options(loaded));
    if (!bytes || bytes.sha256 !== attachment.sha256) fail("PRESERVED_DRAFT_INVALID", "A preserved attachment changed.");
    const output = path.join(loaded.paths.projectRootPath, attachment.relativePath);
    await ensureProjectDirectory(loaded.paths.projectRootPath, path.dirname(output), "draft attachments");
    await writeFileNoReplace(output, bytes.buffer, bytes.sha256, "restored attachment", options(loaded));
  }
}

export async function prepareCurrentVersion(loaded, {
  operationId, expectedSourceSha256, sourceType, sourceHtml, basedOnVersionId,
  draft, recoveryId = null, requestId = null, candidateId = null, clock,
}) {
  checkedId(operationId);
  if (!TYPES.has(sourceType)) fail("CURRENT_VERSION_INVALID", "The Version source is invalid.");
  const member = loaded.manifest.workingCopies.find((w) => w.workingCopyId === loaded.runtime.activeWorkingCopyId);
  const evidence = await currentDraftEvidence(loaded, member);
  if (evidence.source.sha256 !== assertSha256(expectedSourceSha256, "expectedSourceSha256")) fail("WORKING_COPY_CONFLICT", "The current draft changed before creating the Version.");
  const snapshot = Buffer.from(sourceHtml, "utf8");
  const contentSha256 = sha256(snapshot);
  const latest = loaded.manifest.versions.find((v) => v.versionId === loaded.manifest.latestOfficialVersionId);
  const ordinal = latest.ordinal + 1;
  const createdAt = clock();
  const nextVersion = {
    versionId: versionId(ordinal), ordinal, basedOnVersionId, previousVersionId: latest.versionId,
    contentSha256, snapshotRelativePath: `versions/${versionId(ordinal)}/index.html`,
    sourceType, sourceOperationId: operationId, sourceRequestId: requestId, sourceCandidateId: candidateId, createdAt,
    ...(recoveryId ? { sourceRecoveryId: recoveryId } : {}),
  };
  const identified = sourceType === "local-save" ? evidence.source : materializeSourceElementIdentity(sourceHtml);
  const afterBuffer = identified.buffer;
  const afterSha256 = sha256(afterBuffer);
  const afterMember = { ...member, versionId: nextVersion.versionId, basedOnVersionId: nextVersion.versionId };
  const afterDraft = draft === undefined ? evidence.draft : draft;
  const nextDraftRevision = sourceType === "local-save" ? evidence.state.draftRevision : Math.max(evidence.state.draftRevision, afterDraft?.draftRevision || 0) + 1;
  const reboundDraft = afterDraft ? { ...afterDraft, draftRevision: nextDraftRevision, projectId: loaded.project.projectId, documentId: loaded.project.documentId,
    workingCopyId: member.workingCopyId, basedOnVersionId: nextVersion.versionId } : null;
  const afterState = { ...evidence.state, basedOnVersionId: nextVersion.versionId,
    baseSha256: contentSha256, currentSha256: afterSha256, snapshotBaselineSha256: afterSha256,
    differsFromBase: contentSha256 !== afterSha256, saveState: "saved",
    draftSha256: reboundDraft ? sha256(encoded(reboundDraft)) : null,
    draftRevision: nextDraftRevision,
    lastSavedAt: createdAt, sourceElementIdentitySchemaVersion: 1,
    sourceElementIdentityBindingSha256: sourceElementIdentityBindingSha256(afterBuffer.toString("utf8")),
  };
  const transactionPath = currentVersionTransactionPath(loaded, operationId);
  const root = path.dirname(transactionPath);
  await ensureProjectDirectory(loaded.paths.projectRootPath, root, "current Version transaction");
  await writeFileNoReplace(path.join(root, "snapshot.html"), snapshot, contentSha256, "prepared Version", options(loaded));
  await writeFileNoReplace(path.join(root, "after.html"), afterBuffer, afterSha256, "prepared current draft", options(loaded));
  await writeFileNoReplace(path.join(root, "before.html"), evidence.source.buffer, evidence.source.sha256, "protected current draft", options(loaded));
  if (sourceType !== "local-save") {
    await preserveDraft(loaded, member, evidence, { recoveryId: recoveryIdentity(operationId), reason: sourceType, createdAt });
  }
  const bindingPath = path.join(root, "before-binding.ref");
  try { await link(workingCopySourcePath(loaded.paths, member), bindingPath); }
  catch (cause) { if (cause?.code !== "EEXIST") throw cause; }
  const binding = await regularInformation(bindingPath, "protected current binding", options(loaded));
  if (!sameFileIdentity(copyFileIdentity(binding), copyFileIdentity(evidence.source.information))) fail("WORKING_COPY_CONFLICT", "The draft was replaced while preparing its Version.");
  await syncDirectory(root);
  const transaction = { schemaVersion: CURRENT_DRAFT_SCHEMA_VERSION, kind: "current-version", state: "prepared",
    operationId, projectId: loaded.project.projectId, documentId: loaded.project.documentId,
    sourceType, recoveryId, expectedSourceSha256: evidence.source.sha256, afterSha256,
    beforeMember: member, beforeState: evidence.state, beforeDraft: evidence.draft,
    afterMember, afterState, afterDraft: reboundDraft, version: nextVersion, createdAt, openedAt: null };
  await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, transaction, "current Version transaction");
  return transaction;
}

export function assertCurrentVersionTransaction(loaded, transaction, operationId) {
  if (!transaction || transaction.schemaVersion !== CURRENT_DRAFT_SCHEMA_VERSION || transaction.kind !== "current-version"
    || transaction.operationId !== checkedId(operationId) || transaction.projectId !== loaded.project.projectId
    || transaction.documentId !== loaded.project.documentId || !TYPES.has(transaction.sourceType)
    || !["prepared", "source-written", "completed", "aborting", "aborted"].includes(transaction.state)
    || transaction.beforeMember?.workingCopyId !== transaction.afterMember?.workingCopyId
    || transaction.beforeMember?.sourceRelativePath !== transaction.afterMember?.sourceRelativePath
    || transaction.version?.sourceOperationId !== operationId || transaction.version?.sourceType !== transaction.sourceType
    || transaction.afterState?.currentSha256 !== transaction.afterSha256
    || transaction.afterState?.baseSha256 !== transaction.version?.contentSha256) {
    fail("CURRENT_VERSION_INVALID", "The current Version transaction is inconsistent.");
  }
  const currentMember = loaded.manifest.workingCopies.find((member) => member.workingCopyId === transaction.beforeMember.workingCopyId);
  if (!currentMember || currentMember.stateRelativePath !== transaction.beforeMember.stateRelativePath
    || transaction.beforeMember.stateRelativePath !== transaction.afterMember.stateRelativePath
    || (transaction.state !== "completed" && currentMember.sourceRelativePath !== transaction.beforeMember.sourceRelativePath)) {
    fail("CURRENT_VERSION_INVALID", "The transaction does not own the registered current draft.");
  }
  assertSha256(transaction.expectedSourceSha256, "expected source");
  assertSha256(transaction.afterSha256, "prepared source");
  const manifest = { ...loaded.manifest, workingCopies: [transaction.afterMember], versions: loaded.manifest.versions.some((v) => v.versionId === transaction.version.versionId)
    ? loaded.manifest.versions : [...loaded.manifest.versions, transaction.version], latestOfficialVersionId: loaded.manifest.versions.some((v) => v.versionId === transaction.version.versionId) ? loaded.manifest.latestOfficialVersionId : transaction.version.versionId };
  assertManifest(manifest, loaded.project);
  assertWorkingCopyState(transaction.afterState, { ...loaded, manifest }, transaction.afterMember);
  if (transaction.afterDraft) assertWorkingCopyDraft(transaction.afterDraft, sha256(encoded(transaction.afterDraft)), transaction.afterState, { ...loaded, manifest }, transaction.afterMember);
}

async function abortCurrentVersion(loaded, transaction) {
  const transactionPath = currentVersionTransactionPath(loaded, transaction.operationId);
  const root = path.dirname(transactionPath);
  transaction.state = "aborting";
  await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, transaction, "aborting Version");
  // The source is never rolled back over an external editor. Restore only its
  // pre-transaction lineage and comments, while all prepared bytes stay retained.
  const state = { ...transaction.beforeState };
  const draft = transaction.beforeDraft || { schemaVersion: PROJECT_FILE_SCHEMA_VERSION,
    projectId: loaded.project.projectId, documentId: loaded.project.documentId,
    workingCopyId: transaction.beforeMember.workingCopyId, basedOnVersionId: transaction.beforeMember.basedOnVersionId,
    draftRevision: 0, comments: [], changeEvents: [], deletedCommentIds: [], appliedOperationIds: [], updatedAt: transaction.createdAt };
  state.draftSha256 = sha256(encoded(draft));
  await atomicWriteProjectJson(loaded.paths.projectRootPath, path.join(loaded.paths.controlRoot, draftRelativePathFor(transaction.beforeMember)), draft, "retained comments");
  await atomicWriteProjectJson(loaded.paths.projectRootPath, workingCopyStatePath(loaded.paths, transaction.beforeMember), state, "retained current lineage");
  const snapshotPath = versionSnapshotPath(loaded.paths, transaction.version);
  const published = await readRegularFileWithSha256(snapshotPath, "uncommitted snapshot", options(loaded));
  if (published) {
    const retainedPath = path.join(root, "uncommitted-snapshot.html");
    if (await regularInformation(retainedPath, "retained snapshot", options(loaded))) fail("CURRENT_VERSION_CONFLICT", "The uncommitted snapshot needs recovery.");
    await rename(snapshotPath, retainedPath);
    await syncDirectory(path.dirname(snapshotPath));
    await syncDirectory(root);
  }
  transaction.state = "aborted";
  await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, transaction, "aborted Version");
  return currentVersionResult(loaded, transaction);
}

export async function commitCurrentVersion(loaded, transaction, context) {
  assertCurrentVersionTransaction(loaded, transaction, transaction.operationId);
  if (transaction.state === "aborted") return currentVersionResult(loaded, transaction);
  if (transaction.state === "aborting") return abortCurrentVersion(loaded, transaction);
  try { return await commitPreparedCurrentVersion(loaded, transaction, context); }
  catch (cause) {
    if (["WORKING_COPY_CONFLICT", "WORKING_COPY_UNAVAILABLE", "SOURCE_NOT_FOUND", "SOURCE_HASH_CONFLICT", "SAVE_RECOVERY_CONFLICT"].includes(cause?.code)
      && !loaded.manifest.versions.some((v) => v.versionId === transaction.version.versionId)) {
      transaction.failureCode = cause.code;
      await abortCurrentVersion(loaded, transaction);
    }
    throw cause;
  }
}

async function commitPreparedCurrentVersion(loaded, transaction, { hit }) {
  assertCurrentVersionTransaction(loaded, transaction, transaction.operationId);
  const transactionPath = currentVersionTransactionPath(loaded, transaction.operationId);
  const root = path.dirname(transactionPath);
  const snapshot = await readHtmlFile(path.join(root, "snapshot.html"), "prepared Version", options(loaded));
  const after = await readHtmlFile(path.join(root, "after.html"), "prepared current draft", options(loaded));
  if (snapshot.sha256 !== transaction.version.contentSha256 || after.sha256 !== transaction.afterSha256) fail("CURRENT_VERSION_INVALID", "The prepared Version content changed.");
  const committed = loaded.manifest.versions.find((v) => v.versionId === transaction.version.versionId);
  if (committed && JSON.stringify(committed) !== JSON.stringify(transaction.version)) fail("CURRENT_VERSION_CONFLICT", "This Version ordinal was allocated to another operation.");
  if (committed) {
    const immutable = await readHtmlFile(versionSnapshotPath(loaded.paths, committed), "committed Version", options(loaded));
    if (immutable.sha256 !== committed.contentSha256) fail("VERSION_SNAPSHOT_HASH_MISMATCH", "The committed Version changed.");
    // The manifest is the commit point. A later external edit cannot undo it or
    // authorize a replay to overwrite the newer current draft.
    transaction.state = "completed";
    await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, transaction, "committed Version receipt");
    return currentVersionResult(loaded, transaction);
  }
  if (transaction.state === "completed") fail("CURRENT_VERSION_INVALID", "The committed Version is missing.");
  if (!committed && (loaded.manifest.latestOfficialVersionId !== transaction.version.previousVersionId
    || loaded.runtime.activeWorkingCopyId !== transaction.beforeMember.workingCopyId)) fail("CURRENT_VERSION_CONFLICT", "The project advanced before this Version committed.");
  const snapshotPath = versionSnapshotPath(loaded.paths, transaction.version);
  await ensureProjectDirectory(loaded.paths.projectRootPath, path.dirname(snapshotPath), "Version snapshot");
  await writeFileNoReplace(snapshotPath, snapshot.buffer, snapshot.sha256, "Version snapshot", options(loaded));
  await hit("current-version-snapshot-written");
  const sourcePath = workingCopySourcePath(loaded.paths, transaction.beforeMember);
  let current = await readRegularFileWithSha256(sourcePath, "current draft", options(loaded));
  const parkedPath = path.join(root, "parked.html");
  const parked = await readRegularFileWithSha256(parkedPath, "parked current draft", options(loaded));
  if (parked && parked.sha256 !== transaction.expectedSourceSha256) fail("WORKING_COPY_CONFLICT", "An external write to the displaced draft was retained.");
  if (!current) {
    // Only a transaction that actually displaced the old member may restore its name.
    const preparedBinding = await regularInformation(path.join(root, "after-binding.ref"), "prepared current binding", options(loaded));
    const renamedAfter = preparedBinding ? await findBoundSource(loaded.paths.projectRootPath, { information: preparedBinding }) : null;
    if (!parked || transaction.state === "source-written" || renamedAfter) fail("WORKING_COPY_UNAVAILABLE", "The current draft is missing; it was not recreated.");
    if (!preparedBinding) fail("WORKING_COPY_UNAVAILABLE", "The interrupted publication has no current-file binding.");
    await link(path.join(root, "after-binding.ref"), sourcePath);
    await syncDirectory(path.dirname(sourcePath));
    current = await readHtmlFile(sourcePath, "current draft", options(loaded));
  }
  const beforeBinding = await regularInformation(path.join(root, "before-binding.ref"), "protected current binding", options(loaded));
  const afterBinding = await regularInformation(path.join(root, "after-binding.ref"), "prepared current binding", options(loaded));
  if (!((current.sha256 === transaction.expectedSourceSha256 && beforeBinding && sameFileIdentity(copyFileIdentity(current.information), copyFileIdentity(beforeBinding)))
    || (current.sha256 === transaction.afterSha256 && afterBinding && sameFileIdentity(copyFileIdentity(current.information), copyFileIdentity(afterBinding))))) {
    fail("WORKING_COPY_CONFLICT", "The current file object was replaced while creating the Version.");
  }
  if (current.sha256 !== transaction.afterSha256) {
    if (current.sha256 !== transaction.expectedSourceSha256 || committed) fail("WORKING_COPY_CONFLICT", "The current draft changed while creating the Version.");
    const result = await compareAndSwapWorkingCopyFile({ sourcePath, nextBuffer: after.buffer,
      expectedSha256: transaction.expectedSourceSha256, nextSha256: transaction.afterSha256,
      projectRootPath: loaded.paths.projectRootPath, expectedInformation: current.information,
      previousPath: parkedPath, preparedBindingPath: path.join(root, "after-binding.ref"),
      beforePublication: () => hit("current-version-before-publication"),
      afterDisplacement: () => hit("current-version-source-displaced"),
    });
    if (!result.swapped) fail("WORKING_COPY_CONFLICT", "The current draft changed before publication.");
    current = result.written;
  }
  await hit("current-version-source-written");
  await refreshSourceBinding(loaded.paths.projectRootPath, transaction.afterMember.workingCopyId, sourcePath, transaction.afterSha256, { expectedInformation: current.information });
  transaction.afterMember.fileIdentity = copyFileIdentity(current.information);
  transaction.state = "source-written";
  await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, transaction, "current Version transaction");
  const draftPath = path.join(loaded.paths.controlRoot, draftRelativePathFor(transaction.afterMember));
  // An empty draft remains a valid bound record, so no old comment file is silently left authoritative.
  if (!transaction.afterDraft) {
    transaction.afterDraft = { schemaVersion: PROJECT_FILE_SCHEMA_VERSION, projectId: loaded.project.projectId,
      documentId: loaded.project.documentId, workingCopyId: transaction.afterMember.workingCopyId,
      basedOnVersionId: transaction.version.versionId, draftRevision: transaction.afterState.draftRevision, comments: [], changeEvents: [], deletedCommentIds: [], appliedOperationIds: [], updatedAt: transaction.createdAt };
    transaction.afterState.draftSha256 = sha256(encoded(transaction.afterDraft));
    await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, transaction, "current Version transaction");
  }
  await atomicWriteProjectJson(loaded.paths.projectRootPath, draftPath, transaction.afterDraft, "current comments");
  await atomicWriteProjectJson(loaded.paths.projectRootPath, workingCopyStatePath(loaded.paths, transaction.afterMember), transaction.afterState, "current draft state");
  await hit("current-version-state-written");
  const finalSource = await readHtmlFile(sourcePath, "current draft publication", options(loaded));
  if (finalSource.sha256 !== transaction.afterSha256 || !sameFileIdentity(copyFileIdentity(current.information), copyFileIdentity(finalSource.information))) {
    fail("WORKING_COPY_CONFLICT", "The current draft changed before the Version committed.");
  }
  if (!committed) loaded.manifest.versions.push(transaction.version);
  loaded.manifest.workingCopies = [transaction.afterMember];
  loaded.manifest.latestOfficialVersionId = transaction.version.versionId;
  loaded.manifest.currentDraftSchemaVersion = CURRENT_DRAFT_SCHEMA_VERSION;
  assertManifest(loaded.manifest, loaded.project);
  await atomicWriteProjectJson(loaded.paths.projectRootPath, loaded.paths.manifestPath, loaded.manifest, "current Version manifest");
  await hit("current-version-manifest-written");
  transaction.state = "completed";
  await atomicWriteProjectJson(loaded.paths.projectRootPath, transactionPath, transaction, "current Version transaction");
  await hit("current-version-completed");
  return currentVersionResult(loaded, transaction);
}

export function currentVersionResult(loaded, transaction) {
  if (transaction.state === "aborted") return { status: "not-created", operationId: transaction.operationId,
    projectId: loaded.project.projectId, documentId: loaded.project.documentId, failureCode: transaction.failureCode };
  return { status: "created", operationId: transaction.operationId, projectId: loaded.project.projectId,
    documentId: loaded.project.documentId, versionId: transaction.version.versionId,
    versionOrdinal: transaction.version.ordinal, basedOnVersionId: transaction.version.basedOnVersionId,
    previousVersionId: transaction.version.previousVersionId, contentSha256: transaction.version.contentSha256,
    sourceSha256: transaction.afterSha256, sourcePath: workingCopySourcePath(loaded.paths, loaded.manifest.workingCopies.find((member) => member.workingCopyId === transaction.afterMember.workingCopyId) || transaction.afterMember),
    workingCopyId: transaction.afterMember.workingCopyId, sourceType: transaction.sourceType,
    recoveryId: transaction.recoveryId, openedAt: transaction.openedAt,
    recoveryState: loaded.manifest.latestOfficialVersionId !== transaction.version.versionId ? "superseded" : transaction.openedAt ? "opened" : "pending" };
}

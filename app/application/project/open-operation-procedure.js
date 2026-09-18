const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : null;
}

function flatEnvelope(payload, operationId) {
  return Object.freeze({
    operationId,
    snapshotRevision: null,
    core: payload,
    supplemental: payload,
    performanceTiming: record(payload.performanceTiming),
  });
}

export function normalizeProjectOpenWorkspaceEnvelope(payload, operationId) {
  const response = record(payload);
  if (!response) throw new Error("项目状态返回了无效响应。");
  if (Number(response.workspaceEnvelopeVersion || 0) !== 1) {
    return flatEnvelope(response, operationId);
  }
  const responseOperationId = String(response.operationId || "");
  const snapshotRevision = String(response.snapshotRevision || "");
  const core = record(response.core);
  const supplemental = record(response.supplemental);
  if (
    !responseOperationId
    || responseOperationId !== operationId
    || !snapshotRevision
    || !core
    || !supplemental
    || String(supplemental.operationId || "") !== operationId
    || String(supplemental.snapshotRevision || "") !== snapshotRevision
  ) {
    throw new Error("项目状态分层响应缺少一致的 operation identity。");
  }
  return Object.freeze({
    operationId,
    snapshotRevision,
    core,
    supplemental,
    performanceTiming: record(response.performanceTiming),
  });
}

export async function acquireProjectOpenWorkspace({
  bridgeClient,
  sourcePath,
  operationId,
  isCurrent,
} = {}) {
  if (!bridgeClient || typeof bridgeClient.workspace !== "function") {
    throw new TypeError("Project open procedure requires a workspace Bridge port.");
  }
  if (typeof isCurrent !== "function") {
    throw new TypeError("Project open procedure requires a stale fence.");
  }
  const read = typeof bridgeClient.workspaceEnvelope === "function"
    ? bridgeClient.workspaceEnvelope.bind(bridgeClient)
    : bridgeClient.workspace.bind(bridgeClient);
  const payload = await read(sourcePath, { operationId });
  if (!isCurrent()) return Object.freeze({ kind: "stale" });
  return Object.freeze({
    kind: "ready",
    envelope: normalizeProjectOpenWorkspaceEnvelope(payload, operationId),
  });
}

export async function verifyProjectOpenCoreSource({
  core,
  hashPort,
  expectedSourceSha256 = "",
} = {}) {
  const payload = record(core);
  if (!payload || typeof payload.content !== "string") {
    throw new Error("项目 Core 状态缺少当前源 HTML 内容。");
  }
  if (!hashPort || typeof hashPort.sha256 !== "function") {
    throw new TypeError("Project open procedure requires a HashPort.");
  }
  const sourceSha256 = String(
    payload.sourceSha256
    || payload.currentHtmlSha256
    || payload.sha256
    || "",
  );
  if (!SHA256.test(sourceSha256)) {
    throw new Error("项目 Core 状态缺少有效的源 HTML Hash。");
  }
  const calculated = await hashPort.sha256(payload.content);
  if (
    calculated !== sourceSha256
    || (expectedSourceSha256 && expectedSourceSha256 !== sourceSha256)
  ) {
    throw new Error("项目 Core HTML 内容与权威 Hash 不一致。");
  }
  return Object.freeze({
    content: payload.content,
    sourceSha256,
    lastModifiedAt: String(payload.lastModifiedAt || ""),
  });
}

export async function resolveProjectOpenSource({
  core,
  bridgeClient,
  canonicalSourcePath,
  hashPort,
  expectedSourceSha256,
  projectId,
  documentId,
  isCurrent,
  markStage = () => {},
} = {}) {
  if (typeof core?.content === "string") {
    markStage("core-source-verify");
    const verified = await verifyProjectOpenCoreSource({
      core,
      hashPort,
      expectedSourceSha256,
    });
    return Object.freeze({
      ...verified,
      legacyVersionAuthority: null,
    });
  }

  // Injected legacy Bridge ports may still return the historical flat
  // workspace without content. Production always takes the Core branch above.
  markStage("source-request");
  const payload = await bridgeClient.source(canonicalSourcePath);
  markStage("source-response");
  if (!isCurrent()) return Object.freeze({ stale: true });
  if (
    String(payload.projectId || "") !== String(projectId || "")
    || String(payload.documentId || "") !== String(documentId || "")
  ) {
    throw new Error("读取期间源文件身份发生变化，已保持只读；请重新打开该文件。");
  }
  const content = String(payload.content || "");
  const sourceSha256 = String(payload.sha256 || "");
  if (
    !SHA256.test(sourceSha256)
    || await hashPort.sha256(content) !== sourceSha256
    || (expectedSourceSha256 && expectedSourceSha256 !== sourceSha256)
  ) {
    throw new Error("源 HTML 内容与服务端 Hash 不一致，已拒绝开放编辑。");
  }
  return Object.freeze({
    content,
    sourceSha256,
    lastModifiedAt: String(payload.lastModifiedAt || core?.lastModifiedAt || ""),
    legacyVersionAuthority: Object.freeze({
      currentBasedOnVersionId: payload.currentBasedOnVersionId || null,
      currentExactVersionId: payload.currentExactVersionId || null,
      restoredFromVersionId: payload.restoredFromVersionId || null,
    }),
  });
}

export function prepareProjectOpenCore({
  core,
  activeSource,
  exactOpeningAuthority = null,
  sameSourcePath = (left, right) => left === right,
} = {}) {
  const payload = record(core);
  if (!payload) throw new Error("项目 Core 状态无效。");
  const projectId = String(payload.projectId || "");
  const documentId = String(payload.documentId || "");
  const canonicalSourcePath = String(
    payload.sourcePath
    || record(payload.current)?.path
    || activeSource
    || "",
  );
  const sourceSha256 = String(payload.currentHtmlSha256 || payload.sourceSha256 || "");
  const openTarget = record(payload.openTarget);
  if (sourceSha256 && !SHA256.test(sourceSha256)) {
    throw new Error("项目状态返回的源 HTML Hash 无效。");
  }
  if (exactOpeningAuthority) {
    const expected = exactOpeningAuthority;
    if (
      projectId !== expected.projectId
      || documentId !== expected.documentId
      || sourceSha256 !== expected.sourceSha256
      || !openTarget
      || String(openTarget.projectId || "") !== expected.openTarget.projectId
      || String(openTarget.documentId || "") !== expected.openTarget.documentId
      || String(openTarget.workingCopyId || "") !== expected.openTarget.workingCopyId
      || String(openTarget.versionId || "") !== expected.openTarget.versionId
      || String(openTarget.sourceSha256 || "") !== expected.openTarget.sourceSha256
      || !sameSourcePath(openTarget.exactSourcePath, activeSource)
    ) {
      throw new Error("项目在首屏显示后发生变化，已保持只读；请重新打开该文件。");
    }
  }
  return Object.freeze({
    projectId,
    documentId,
    canonicalSourcePath,
    sourceSha256,
    openTarget,
  });
}

export async function inspectProjectOpenProjection({
  document,
  hashPort,
  workspaceSha256,
  hasExactOpeningAuthority = false,
  pendingWrite = false,
  flushInFlight = false,
} = {}) {
  const current = record(document) || {};
  const currentHtmlSha256 = hasExactOpeningAuthority
    ? String(current.workingHtmlSha256 || current.persistedSourceSha256 || "")
    : await hashPort.sha256(String(current.html || ""));
  const clean = Boolean(
    current.persistState === "idle"
    && Number(current.editRevision || 0) === Number(current.lastPersistedRevision || 0)
    && !pendingWrite
    && !flushInFlight
  );
  return Object.freeze({
    clean,
    cleanMismatch: Boolean(clean && workspaceSha256 && currentHtmlSha256 !== workspaceSha256),
  });
}

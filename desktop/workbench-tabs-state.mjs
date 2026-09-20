import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const VERSION = 2;
const EXACT_ROOT_KEYS = new Set(["version", "activeTabId", "tabs"]);
const EXACT_TAB_KEYS = new Set([
  "tabId", "kind", "projectId", "documentId",
  "versionId", "versionOrdinal",
]);

function cleanString(value, pattern, maxLength) {
  if (typeof value !== "string" || !value || value.length > maxLength || !pattern.test(value)) {
    return null;
  }
  return value;
}

export function normalizeWorkbenchTabsState(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).some((key) => !EXACT_ROOT_KEYS.has(key))) return null;
  if (value.version !== VERSION || !Array.isArray(value.tabs)) {
    return null;
  }
  const tabs = [];
  const tabIds = new Set();
  const surfaceIds = new Set();
  for (const candidate of value.tabs) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    if (Object.keys(candidate).some((key) => !EXACT_TAB_KEYS.has(key))) return null;
    const kind = String(candidate.kind || "");
    if (!["document", "project-rules", "history"].includes(kind)) return null;
    const tabId = cleanString(candidate.tabId, /^[A-Za-z0-9:_-]+$/u, 240);
    const projectId = cleanString(candidate.projectId, /^project_[A-Za-z0-9_-]+$/u, 180);
    const documentId = cleanString(candidate.documentId, /^doc_[A-Za-z0-9_-]+$/u, 180);
    const surfaceKey = `${kind}\u0000${projectId}\u0000${documentId}`;
    if (
      !tabId || !projectId || !documentId
      || tabIds.has(tabId) || surfaceIds.has(surfaceKey)
    ) return null;
    let history = {};
    if (kind === "history") {
      const versionId = cleanString(candidate.versionId, /^[A-Za-z0-9_-]+$/u, 180);
      const versionOrdinal = Number(candidate.versionOrdinal);
      if (!versionId || !Number.isInteger(versionOrdinal) || versionOrdinal < 1) return null;
      history = { versionId, versionOrdinal };
    } else if (["versionId", "versionOrdinal"]
      .some((key) => Object.hasOwn(candidate, key))) return null;
    tabIds.add(tabId);
    surfaceIds.add(surfaceKey);
    tabs.push(Object.freeze({ tabId, kind, projectId, documentId, ...history }));
  }
  const activeTabId = value.activeTabId === null
    ? null
    : cleanString(value.activeTabId, /^[A-Za-z0-9:_-]+$/u, 240);
  if (activeTabId && !tabIds.has(activeTabId)) return null;
  return Object.freeze({
    version: VERSION,
    activeTabId,
    tabs: Object.freeze(tabs),
  });
}

export async function readWorkbenchTabsState({ userDataPath }) {
  const filePath = path.join(userDataPath, "workbench-tabs.json");
  try {
    const raw = await readFile(filePath, "utf8");
    const normalized = normalizeWorkbenchTabsState(JSON.parse(raw));
    if (!normalized) throw new TypeError("已保存的工作台标签状态无效。");
    return normalized;
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    throw cause;
  }
}

export async function writeWorkbenchTabsState({ userDataPath, state }) {
  const normalized = normalizeWorkbenchTabsState(state);
  if (!normalized) throw new TypeError("工作台标签状态无效。");
  const filePath = path.join(userDataPath, "workbench-tabs.json");
  const contents = `${JSON.stringify(normalized, null, 2)}\n`;
  await mkdir(userDataPath, { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx", mode: 0o600 });
    await rename(temporaryPath, filePath);
  } finally {
    await unlink(temporaryPath).catch(() => {});
  }
  return normalized;
}

import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  WORKSPACE_PREFERENCE_DEFAULTS,
  WORKSPACE_PREFERENCE_SCHEMA_VERSION,
  normalizeWorkspacePatch,
  normalizeWorkspacePreferences,
} from "../shared/workspace-preferences.mjs";

export const UI_PREFERENCES_FILE_NAME = "ui-preferences.json";
export const UI_PREFERENCES_SCHEMA_VERSION = WORKSPACE_PREFERENCE_SCHEMA_VERSION;

const MAX_STATE_BYTES = 16 * 1024;

// Main owns the only durable preference writer so Settings and Agent updates
// cannot overwrite one another from concurrent read-modify-write operations.
let writeTail = Promise.resolve();

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function emptyWorkspacePreferences() {
  return Object.freeze({ ...WORKSPACE_PREFERENCE_DEFAULTS });
}

function emptyPreferences() {
  return Object.freeze({
    schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
    workspace: emptyWorkspacePreferences(),
  });
}


function freezePreferences(value) {
  return Object.freeze({
    schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
    workspace: normalizeWorkspacePreferences(value?.workspace),
  });
}

function preferencesPath(userDataPath) {
  if (typeof userDataPath !== "string" || !path.isAbsolute(userDataPath)) {
    throw new TypeError("UI preferences require an absolute userData path.");
  }
  return path.join(userDataPath, UI_PREFERENCES_FILE_NAME);
}

async function atomicWrite(filePath, payload) {
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporaryPath, filePath);
  } catch (cause) {
    await unlink(temporaryPath).catch(() => {});
    throw cause;
  }
}

export function decodeUiPreferences(raw) {
  if (raw == null) return emptyPreferences();
  let parsed;
  try {
    parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return emptyPreferences();
  }
  if (!isRecord(parsed)) return emptyPreferences();
  if (parsed.schemaVersion === UI_PREFERENCES_SCHEMA_VERSION) {
    return freezePreferences(parsed);
  }
  return emptyPreferences();
}

async function readUiPreferencesFile({ userDataPath }) {
  const filePath = preferencesPath(userDataPath);
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { preferences: emptyPreferences(), desktop: {} };
    return { preferences: emptyPreferences(), desktop: {} };
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_STATE_BYTES) {
    return { preferences: emptyPreferences(), desktop: {} };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { preferences: emptyPreferences(), desktop: {} };
  }
  const current = isRecord(parsed) && parsed.schemaVersion === UI_PREFERENCES_SCHEMA_VERSION;
  return {
    preferences: decodeUiPreferences(parsed),
    desktop: current ? normalizedDesktopPreferences(parsed) : {},
  };
}

function normalizedDesktopPreferences(value) {
  const directory = value?.desktop?.lastExportDirectory;
  return typeof directory === "string" && directory.length <= 4096
    && !directory.includes("\0") && path.isAbsolute(directory)
    ? { lastExportDirectory: path.resolve(directory) }
    : {};
}

function durablePreferences(preferences, desktop) {
  return desktop?.lastExportDirectory ? { ...preferences, desktop } : preferences;
}

// Native export convenience stays private to Main and shares the existing
// preference write queue. It is not a renderer-editable workspace preference.
export async function readLastExportDirectory({ userDataPath } = {}) {
  return (await readUiPreferencesFile({ userDataPath })).desktop?.lastExportDirectory || null;
}

export async function recordLastExportDirectory({ userDataPath, directoryPath } = {}) {
  const desktop = normalizedDesktopPreferences({ desktop: { lastExportDirectory: directoryPath } });
  if (!desktop.lastExportDirectory) throw new TypeError("Export directory must be an absolute path.");
  return enqueueWrite(async () => {
    const current = await readUiPreferencesFile({ userDataPath });
    await atomicWrite(preferencesPath(userDataPath), durablePreferences(current.preferences, desktop));
  });
}

export async function readUiPreferences({ userDataPath } = {}) {
  return (await readUiPreferencesFile({ userDataPath })).preferences;
}

async function writeUiPreferences(userDataPath, next, desktop) {
  const frozen = freezePreferences(next);
  await atomicWrite(preferencesPath(userDataPath), durablePreferences(frozen, desktop));
  return frozen;
}

function enqueueWrite(task) {
  const next = writeTail.then(task, task);
  writeTail = next.catch(() => {});
  return next;
}

async function updateUiPreferences(userDataPath, update) {
  return enqueueWrite(async () => {
    const loaded = await readUiPreferencesFile({ userDataPath });
    const current = loaded.preferences;
    const next = update(current);
    return next === current ? current : writeUiPreferences(userDataPath, next, loaded.desktop);
  });
}

export async function recordUiWorkspacePreferences({
  userDataPath,
  workspace,
} = {}) {
  const patch = normalizeWorkspacePatch(workspace);
  return updateUiPreferences(userDataPath, (current) => ({
    ...current,
    workspace: {
      ...current.workspace,
      ...patch,
    },
  }));
}

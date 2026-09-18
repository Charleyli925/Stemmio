function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const REQUIRED_DESKTOP_CAPABILITIES = Object.freeze({
  sourceEditing: "enabled",
  projectOpening: "desktop-dialog",
  attachmentPersistence: "bridge",
  closeCoordination: "electron-handshake",
  interactivePreview: "independent-url",
});

const REQUIRED_DESKTOP_HOST_FUNCTIONS = Object.freeze([
  ["stemmioProjects", "getActiveProject"],
  ["stemmioProjects", "openHtml"],
  ["stemmioPreview", "createSession"],
  ["stemmioPreview", "revokeSession"],
  ["stemmioAppLifecycle", "onPrepareClose"],
  ["stemmioAppLifecycle", "onCloseAborted"],
  ["stemmioAppLifecycle", "reportReady"],
  ["stemmioAppLifecycle", "reportBlocked"],
  ["stemmioIntegrations", "persistSessionCredential"],
  ["stemmioIntegrations", "clearSessionCredential"],
  ["stemmioIntegrations", "sessionCredentialStatus"],
  ["stemmioIntegrations", "restoreSessionCredential"],
]);

export function assertDesktopHost(host) {
  if (!isRecord(host)) {
    throw new TypeError("桌面运行环境未初始化：窗口主机不可用。");
  }
  if (
    !isRecord(host.stemmioRuntime)
    || !isRecord(host.stemmioRuntime.capabilities)
    || Object.entries(REQUIRED_DESKTOP_CAPABILITIES).some(
      ([name, value]) => host.stemmioRuntime.capabilities[name] !== value,
    )
  ) {
    throw new TypeError("桌面运行环境未初始化：能力声明缺失或无效。");
  }
  const missing = REQUIRED_DESKTOP_HOST_FUNCTIONS
    .filter(([owner, name]) => typeof host[owner]?.[name] !== "function")
    .map(([owner, name]) => `${owner}.${name}`);
  if (missing.length > 0) {
    throw new TypeError(`桌面运行环境未初始化：缺少 ${missing.join("、")}。`);
  }
}

import { ProjectFileError } from "../project-files.mjs";
import { handoffToQoderWork } from "../qoder-handoff.mjs";
import {
  AGENT_VENDOR_KEY_VENDOR_IDS,
  publicAgentVendorKeyUrl,
} from "../../shared/agent-vendor-key-url.mjs";

const VENDOR_KEY_IDS = new Set(AGENT_VENDOR_KEY_VENDOR_IDS);

const LOGIN_PROVIDER_IDS = new Set(["qoder", "codex"]);

export function registerAgentIpc({
  ipcMain,
  trustedProject,
  INTEGRATION_CHANNELS,
  clipboard,
  openAgentLogin,
  openVendorApiKeyPage,
  persistSessionCredential,
  clearSessionCredential,
  sessionCredentialStatus,
  restoreSessionCredential,
}) {
  ipcMain.handle(
    INTEGRATION_CHANNELS.qoderHandoff,
    trustedProject((payload) => {
      if (
        process.env.STEMMIO_E2E === "1"
        && process.env.STEMMIO_E2E_QODER_HANDOFF_FAILURE === "1"
      ) {
        throw new ProjectFileError(
          "E2E_QODER_HANDOFF_FAILED",
          "测试注入：交接内容未能写入剪贴板。",
        );
      }
      return handoffToQoderWork(payload, {
        writeClipboard: (message) => clipboard.writeText(message),
        readClipboard: () => clipboard.readText(),
      });
    }, "qoder_handoff"),
  );
  ipcMain.handle(
    INTEGRATION_CHANNELS.openAgentLogin,
    trustedProject(async (payload) => {
      const providerId = String(payload?.providerId || "").trim();
      if (!LOGIN_PROVIDER_IDS.has(providerId)) {
        throw new ProjectFileError(
          "AGENT_LOGIN_UNSUPPORTED",
          "This Agent cannot start an official login.",
        );
      }
      if (typeof openAgentLogin !== "function") {
        throw new ProjectFileError(
          "AGENT_LOGIN_URL_UNAVAILABLE",
          "官方登录页暂时无法打开。",
        );
      }
      return openAgentLogin(providerId);
    }, "agent_open_login"),
  );
  ipcMain.handle(
    INTEGRATION_CHANNELS.openVendorApiKey,
    trustedProject(async (payload) => {
      const vendorId = String(payload?.vendorId || "").trim();
      if (!VENDOR_KEY_IDS.has(vendorId) || !publicAgentVendorKeyUrl(vendorId)) {
        throw new ProjectFileError(
          "AGENT_VENDOR_KEY_UNSUPPORTED",
          "当前服务没有经过校验的 API Key 页面。",
        );
      }
      if (typeof openVendorApiKeyPage !== "function") {
        throw new ProjectFileError(
          "AGENT_VENDOR_KEY_UNAVAILABLE",
          "无法打开获取 API Key 页面。",
        );
      }
      return openVendorApiKeyPage(vendorId);
    }, "agent_open_vendor_key"),
  );
  ipcMain.handle(
    INTEGRATION_CHANNELS.persistSessionCredential,
    trustedProject(async (payload) => {
      if (typeof persistSessionCredential !== "function") {
        throw new ProjectFileError(
          "AGENT_CREDENTIAL_STORE_UNAVAILABLE",
          "无法安全保存 API Key。",
        );
      }
      return persistSessionCredential({
        operationId: payload?.operationId,
        apiKey: payload?.apiKey,
        vendorId: payload?.vendorId,
        baseUrl: payload?.baseUrl,
        modelId: payload?.modelId,
      });
    }, "agent_persist_credential"),
  );
  ipcMain.handle(
    INTEGRATION_CHANNELS.clearSessionCredential,
    trustedProject(async (payload) => {
      if (typeof clearSessionCredential !== "function") {
        throw new ProjectFileError(
          "AGENT_CREDENTIAL_STORE_UNAVAILABLE",
          "无法安全移除 API Key。",
        );
      }
      return clearSessionCredential({
        operationId: payload?.operationId,
        expectedRecordId: payload?.expectedRecordId ?? null,
      });
    }, "agent_clear_credential"),
  );
  ipcMain.handle(
    INTEGRATION_CHANNELS.sessionCredentialStatus,
    trustedProject(async (payload) => {
      if (typeof sessionCredentialStatus !== "function") {
        throw new ProjectFileError(
          "AGENT_CREDENTIAL_STORE_UNAVAILABLE",
          "无法确认 API Key 的保存状态。",
        );
      }
      return sessionCredentialStatus({ operationId: payload?.operationId });
    }, "agent_credential_status"),
  );
  ipcMain.handle(
    INTEGRATION_CHANNELS.restoreSessionCredential,
    trustedProject(async () => {
      if (typeof restoreSessionCredential !== "function") {
        throw new ProjectFileError(
          "AGENT_CREDENTIAL_STORE_UNAVAILABLE",
          "无法读取已保存的 API Key。",
        );
      }
      return restoreSessionCredential();
    }, "agent_restore_credential"),
  );
}

export function unregisterAgentIpc({ ipcMain, INTEGRATION_CHANNELS }) {
  for (const channel of Object.values(INTEGRATION_CHANNELS)) {
    ipcMain.removeHandler(channel);
  }
}
